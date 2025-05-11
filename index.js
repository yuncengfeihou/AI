// public/extensions/third-party/AI/index.js

import { getContext } from '../../../../scripts/st-context.js';
import { renderExtensionTemplateAsync, extension_settings } from '../../../../scripts/extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const extensionName = "AI";

const defaultSettings = {
    apiMode: "st_current_api", // 'st_current_api' 或 'custom_third_party'
    customApiUrl: "",
    customApiKey: "",
};

let pluginSettings = {};

async function loadPluginSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    pluginSettings = { ...defaultSettings, ...extension_settings[extensionName] };

    $('#adv_ai_api_mode').val(pluginSettings.apiMode);
    $('#adv_ai_custom_api_url').val(pluginSettings.customApiUrl);
    $('#adv_ai_custom_api_key').val(pluginSettings.customApiKey);

    toggleCustomApiConfigArea(pluginSettings.apiMode);
    console.log(`${extensionName}: Settings loaded. Mode: ${pluginSettings.apiMode}`);
}

function savePluginSettings() {
    extension_settings[extensionName].apiMode = pluginSettings.apiMode;
    extension_settings[extensionName].customApiUrl = pluginSettings.customApiUrl;
    extension_settings[extensionName].customApiKey = pluginSettings.customApiKey;
    saveSettingsDebounced();
    console.log(`${extensionName}: Settings saved.`);
}

function toggleCustomApiConfigArea(selectedMode) {
    if (selectedMode === "custom_third_party") {
        $('#adv_ai_custom_api_config_area').slideDown();
    } else {
        $('#adv_ai_custom_api_config_area').slideUp();
    }
}

async function handleGenerate() {
    const context = getContext();
    const prompt = $('#adv_ai_prompt_input').val().trim();

    if (!prompt) {
        toastr.warning("请输入提示内容。", "提示为空");
        return;
    }

    const generateButton = $('#adv_ai_generate_button');
    const loadingSpinner = $('#adv_ai_loading_spinner');
    const responseOutput = $('#adv_ai_response_output');

    generateButton.prop('disabled', true);
    loadingSpinner.show();
    responseOutput.html("<i>正在努力生成中...</i>");

    let generatedText = "";
    let apiError = null;

    try {
        if (pluginSettings.apiMode === "st_current_api") {
            console.log(`${extensionName}: Using SillyTavern's current API for raw prompt (via ST Services).`);

            const mainApi = context.mainApi;
            let requestData = {};
            let serviceUsed = null; // 标记使用了哪个服务

            // 根据当前API选择合适的服务
            switch (mainApi) {
                case 'kobold':
                case 'koboldhorde':
                case 'textgenerationwebui':
                case 'novel':
                     serviceUsed = context.TextCompletionService;
                     requestData = {
                         prompt: prompt,
                         max_length: context.amountGen,
                         // TextCompletionService 会使用 power_user 和相应的 backend_settings
                         // 这里可以覆盖一些基本参数
                         temperature: power_user.temperature,
                         top_p: power_p.top_p,
                     };
                    break;
                case 'openai': // 适配 OpenAI (和其他 Chat Completion APIs)
                    serviceUsed = context.ChatCompletionService;
                    // ChatCompletionService.generate 通常期望 messages 数组作为主要输入
                    requestData = {
                        messages: [{ role: "user", content: prompt }],
                        // ChatCompletionService 会使用 oai_settings
                        // 这里可以覆盖一些基本参数
                        max_tokens: context.chatCompletionSettings.openai_max_tokens || 500,
                        temperature: context.chatCompletionSettings.openai_temperature,
                        top_p: context.chatCompletionSettings.openai_top_p,
                        // model: context.getChatCompletionModel(), // 可以在请求数据中指定模型，或依赖服务使用配置的模型
                    };
                    break;
                default:
                    apiError = `SillyTavern 当前配置的 API (${mainApi}) 不支持通过此插件模式直接发送原始提示。`;
                    throw new Error(apiError);
            }

            if (serviceUsed) {
                // 调用选定的服务
                // TextCompletionService.generate(prompt, options, signal)
                // ChatCompletionService.generate(requestData, options, signal) options 通常是空的或仅用于覆盖默认设置
                let responseData;
                if (serviceUsed === context.TextCompletionService) {
                     // TextCompletionService 第一个参数是 prompt 字符串
                     responseData = await serviceUsed.generate(prompt, requestData, context.abortController?.signal);
                } else { // ChatCompletionService
                     // ChatCompletionService 第一个参数是 requestData 对象 (包含 messages)
                     // generate 方法通常会使用 requestData 的内容和内部的 oai_settings
                     // 我们可以将 requestData 作为 options 传递，但更标准的用法是直接传入 requestData 的核心内容
                     // 但为了覆盖参数方便，我们可以尝试将 requestData 作为 options 传递
                     // 实际上 ChatCompletionService.generate 的第一个参数是 `requestData`，第二个是 `options` (覆盖参数)，第三个是 `signal`
                     // 我们可以直接传递构建好的 requestData
                     responseData = await serviceUsed.generate(requestData, {}, context.abortController?.signal);
                }


                 // extractMessageFromData 期望原始的响应数据对象
                 generatedText = context.extractMessageFromData(responseData, mainApi); // 传入 mainApi 帮助解析

                 if (!generatedText) {
                     apiError = `API (${mainApi}) 调用成功但未提取到文本内容。`;
                     console.warn(`${extensionName}: API response did not contain extractable message. Response:`, responseData);
                 }

            }


        } else if (pluginSettings.apiMode === "custom_third_party") {
            // 保留原有的使用 TextCompletionService 的逻辑
            // 注意：这个分支仍然假设你的自定义API兼容 TextCompletionService
            // 如果不兼容，你可能需要在这里直接使用 fetch 并完全控制请求体和端点
            const customApiUrl = pluginSettings.customApiUrl;
            const customApiKey = pluginSettings.customApiKey;

            if (!customApiUrl) {
                apiError = "请先配置自定义API URL。";
                throw new Error(apiError);
            } else {
                console.log(`${extensionName}: Using custom third-party API: ${customApiUrl} (via TextCompletionService).`);
                // TextCompletionService.generate 内部会构建请求体并调用 fetch
                // 它的参数结构可能与上面直接 fetch 不同，但它声称支持 "generic" 类型
                const requestOptions = {
                    api_server: customApiUrl,
                    ...(customApiKey && { api_key: customApiKey }),
                    prompt: prompt, // 发送用户提示
                    max_length: context.amountGen, // 示例：使用ST配置的最大生成长度
                    temperature: power_user.temperature,
                    top_p: power_user.top_p,
                    // ... 其他你希望传递的参数
                };

                try {
                     const responseData = await context.TextCompletionService.generate(
                        prompt, // TextCompletionService 通常将 prompt 作为第一个参数
                        requestOptions, // options 用于配置 api_server, api_key 等
                        context.abortController?.signal
                     );

                     if (typeof responseData === 'string') {
                         generatedText = responseData;
                     } else {
                         generatedText = context.extractMessageFromData(responseData, 'generic'); // 假设自定义API是generic类型
                     }


                     if (!generatedText) {
                         apiError = "自定义API未返回可识别的文本内容。";
                         console.error(`${extensionName}: Custom API response did not contain extractable message or was unexpected. Response:`, responseData);
                     }
                } catch (e) {
                     apiError = `自定义 API 调用失败: ${e.message || e}`;
                     console.error(`${extensionName}: Custom API fetch failed:`, e);
                     throw new Error(apiError);
                }
            }
        }

        // 显示结果
        if (generatedText) {
            const formattedText = context.messageFormatting(generatedText, "AI", false, false, -1, {}, false);
            responseOutput.html(formattedText);
        } else {
            responseOutput.text(apiError || "生成成功，但未提取到文本内容。");
        }


    } catch (error) {
        // 捕获并显示错误
        console.error(`${extensionName}: Generation failed:`, error);
        let errorMessage = "生成失败。";
        if (error.message) {
             errorMessage = `生成失败: ${error.message}`;
        } else if (typeof error === 'string') {
             errorMessage = `生成失败: ${error}`;
        } else if (apiError) {
             errorMessage = `生成失败: ${apiError}`;
        } else if (error instanceof Error) {
            errorMessage = `生成失败: ${error.name} - ${error.message}`;
        }
        responseOutput.text(errorMessage);
        toastr.error(errorMessage, "生成失败");
    } finally {
        // 确保按钮恢复可用状态并隐藏加载指示器
        generateButton.prop('disabled', false);
        loadingSpinner.hide();
    }
}

// DOM加载完成后执行
jQuery(async () => {
    console.log(`${extensionName}: Initializing...`);

    try {
        const html = await renderExtensionTemplateAsync(`third-party/${extensionName}`, 'settings_ui');
        // 使用更稳健的方式查找扩展设置容器
        const container = $('#extensions_settings').find('.extension_settings_container').first();
        if (container.length) {
            container.append(html);
        } else {
             // 如果找不到特定容器，回退到直接添加到 #extensions_settings (旧版本ST兼容)
             $('#extensions_settings').append(html);
        }
        console.log(`${extensionName}: UI injected.`);

        await loadPluginSettings(); // 加载并应用保存的设置

        // 事件绑定
        $('#adv_ai_api_mode').on('change', function() {
            pluginSettings.apiMode = $(this).val();
            toggleCustomApiConfigArea(pluginSettings.apiMode);
            savePluginSettings();
        });

        $('#adv_ai_custom_api_url').on('input', function() {
            pluginSettings.customApiUrl = $(this).val().trim();
            savePluginSettings();
        });

        $('#adv_ai_custom_api_key').on('input', function() {
            pluginSettings.customApiKey = $(this).val();
            savePluginSettings();
        });

        $('#adv_ai_generate_button').on('click', handleGenerate);

        console.log(`${extensionName}: Initialization complete.`);

    } catch (error) {
        console.error(`${extensionName}: Failed to initialize -`, error);
        toastr.error(`插件 ${extensionName} 初始化失败。详情请查看控制台。`);
    }
});
