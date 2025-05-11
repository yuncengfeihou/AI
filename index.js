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

// 事件绑定现在在 jQuery(async () => { ... }); 内部完成

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
            console.log(`${extensionName}: Using SillyTavern's current API for raw prompt (via direct fetch).`);

            const mainApi = context.mainApi;
            let endpoint = '';
            let requestData = {};
            const headers = context.getRequestHeaders();

            // 根据不同的API构建请求体和确定端点
            switch (mainApi) {
                case 'kobold':
                    endpoint = '/api/backends/kobold/generate';
                    requestData = {
                        prompt: prompt,
                        max_length: context.amountGen, // 使用ST配置的最大生成长度
                        // 可以根据需要添加其他少量参数，但目标是最小化
                        temperature: power_user.temperature, // 示例：可以包含一些通用设置
                        top_p: power_user.top_p,
                        // 注意：这里不包含 character_name, description, chat history 等，
                        // 因为目标是发送原始prompt
                    };
                    break;
                case 'koboldhorde': // Horde 也可以发送原始提示
                     endpoint = '/api/backends/koboldhorde/generate';
                     requestData = {
                        prompt: prompt,
                        max_length: context.amountGen, // 使用ST配置的最大生成长度
                        // Horde 参数结构可能有所不同，但核心应包含 prompt 和 max_length
                        // 后端代理会处理Horde特定的参数映射和密钥
                     };
                     break;
                case 'textgenerationwebui': // 适配 Ooba, KoboldCPP, LlamaCPP 等 Text Completion 后端
                    endpoint = '/api/backends/text-completions/generate';
                    requestData = {
                        prompt: prompt,
                        max_length: context.amountGen, // 使用ST配置的最大生成长度
                        // text-completions 代理会根据具体后端类型处理参数
                        // 默认可能会使用 textgen-settings.js 中的配置
                        temperature: power_user.temperature, // 示例：可以包含一些通用设置
                        top_p: power_user.top_p,
                    };
                    break;
                case 'novel': // NovelAI
                    endpoint = '/api/novelai/generate';
                    requestData = {
                        prompt: prompt,
                        max_length: context.amountGen, // 使用ST配置的最大生成长度
                        // NovelAI 代理会处理 NovelAI 密钥和参数映射
                         temperature: context.nai_settings.temperature_novel, // 示例：使用NovelAI特定设置
                         top_p: context.nai_settings.top_p_novel,
                         // ... 其他 NovelAI 相关设置
                    };
                    break;
                case 'openai': // 适配 OpenAI (包括通过 ST 代理的其他 Chat Completion API)
                    endpoint = '/api/openai/chat/completions'; // Chat Completion API 端点
                    requestData = {
                        messages: [{ role: "user", content: prompt }], // Chat Completion 格式
                        max_tokens: context.chatCompletionSettings.openai_max_tokens || 500, // 使用OAI配置的最大令牌数
                        temperature: context.chatCompletionSettings.openai_temperature, // 使用OAI特定设置
                        top_p: context.chatCompletionSettings.openai_top_p,
                        // ... 其他相关设置，如 model (通常由ST后端根据配置处理)
                    };
                    // OpenAI 不需要设置 'Content-Type': 'application/json' 之外的其他头部
                    break;
                default:
                    // 如果是其他未适配的API类型
                    apiError = `SillyTavern 当前配置的 API (${mainApi}) 不支持此模式。`;
                    throw new Error(apiError); // 抛出错误以进入catch块
            }

             // 发送请求
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: headers, // 使用 SillyTavern 的通用头部 (包含 CSRF token)
                body: JSON.stringify(requestData),
                signal: context.abortController?.signal, // 允许通过 ST 的停止按钮取消
            });

            if (!response.ok) {
                // 处理非2xx响应状态码
                let errorBody;
                try {
                    errorBody = await response.json();
                } catch {
                    errorBody = { message: response.statusText };
                }
                apiError = `API 返回错误 ${response.status}: ${errorBody.message || JSON.stringify(errorBody)}`;
                throw new Error(apiError); // 抛出错误以进入catch块
            }

            // 处理成功响应
            const responseData = await response.json();

            // 使用 context.extractMessageFromData 提取文本，传入实际API类型以确保正确解析
            generatedText = context.extractMessageFromData(responseData, mainApi);

            if (!generatedText) {
                apiError = `API ${mainApi} 调用成功但未提取到文本内容。`;
                console.warn(`${extensionName}: API response did not contain extractable message. Response:`, responseData);
                // 即使未提取到文本，也不抛出错误，让responseOutput显示空结果或警告
            }


        } else if (pluginSettings.apiMode === "custom_third_party") {
            // 保留原有的使用 TextCompletionService 的逻辑
            const customApiUrl = pluginSettings.customApiUrl;
            const customApiKey = pluginSettings.customApiKey;

            if (!customApiUrl) {
                apiError = "请先配置自定义API URL。";
                throw new Error(apiError);
            } else {
                console.log(`${extensionName}: Using custom third-party API: ${customApiUrl}`);
                const requestOptions = {
                    api_server: customApiUrl,
                    ...(customApiKey && { api_key: customApiKey }),
                    // TextCompletionService 通常期望 Text Completion 类的参数结构
                    prompt: prompt, // 发送用户提示
                    max_length: context.amountGen, // 示例：使用ST配置的最大生成长度
                    temperature: power_user.temperature,
                    top_p: power_user.top_p,
                    // ... 其他你希望传递的参数 (依赖于 TextCompletionService 的实现和后端代理的能力)
                };

                try {
                     const responseData = await context.TextCompletionService.generate(
                        prompt,
                        requestOptions,
                        context.abortController?.signal // 允许取消
                     );
                     generatedText = context.extractMessageFromData(responseData);
                     if (!generatedText) {
                         apiError = "自定义API未返回可识别的文本内容。";
                         console.error(`${extensionName}: Custom API response did not contain extractable message. Response:`, responseData);
                     }
                } catch (e) {
                     apiError = `Custom API call failed: ${e.message || e}`;
                     console.error(`${extensionName}: Custom API fetch failed:`, e);
                     throw new Error(apiError); // 抛出错误以进入catch块
                }
            }
        }

        // 显示结果
        if (generatedText) {
            // 对于从API返回的文本，使用SillyTavern的格式化函数进行处理
            const formattedText = context.messageFormatting(generatedText, "AI", false, false, -1, {}, false);
            responseOutput.html(formattedText);
        } else {
            // 如果没有提取到文本，显示一个提示
            responseOutput.text(apiError || "生成成功，但未提取到文本内容。");
        }


    } catch (error) {
        // 捕获并显示错误
        console.error(`${extensionName}: Generation failed:`, error);
        let errorMessage = "生成失败。";
        if (error.message) {
             errorMessage += ` 错误: ${error.message}`;
        } else if (typeof error === 'string') {
             errorMessage += ` ${error}`;
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
