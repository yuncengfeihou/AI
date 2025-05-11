// public/extensions/third-party/AI/index.js

import { getContext } from '../../../../scripts/st-context.js';
import { renderExtensionTemplateAsync, extension_settings } from '../../../../scripts/extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { debounce_timeout } from '../../../../scripts/constants.js'; // 导入 debounce_timeout

const extensionName = "AI";

const defaultSettings = {
    apiMode: "st_current_api", // 'st_current_api' 或 'custom_third_party'
    customApiUrl: "",
    customApiKey: "", // 存储密钥通常不安全，但这里遵循您的原有逻辑
};

let pluginSettings = {};
let saveSettingsDebouncedLocal; // 用于延迟保存设置

async function loadPluginSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    pluginSettings = { ...defaultSettings, ...extension_settings[extensionName] };

    // 确保所有默认设置都存在
    for (const key in defaultSettings) {
        if (pluginSettings[key] === undefined) {
            pluginSettings[key] = defaultSettings[key];
        }
    }


    $('#adv_ai_api_mode').val(pluginSettings.apiMode);
    $('#adv_ai_custom_api_url').val(pluginSettings.customApiUrl);
    $('#adv_ai_custom_api_key').val(pluginSettings.customApiKey); // 注意：不建议在前端存储敏感信息

    toggleCustomApiConfigArea(pluginSettings.apiMode);
    console.log(`${extensionName}: Settings loaded. Mode: ${pluginSettings.apiMode}`);
}

function savePluginSettings() {
    // 使用一个延迟函数来避免频繁保存
    if (!saveSettingsDebouncedLocal) {
         // 创建一个 debounced 函数，延迟时间使用 SillyTavern 的默认保存延迟
        saveSettingsDebouncedLocal = debounce((settingsToSave) => {
             extension_settings[extensionName] = { ...extension_settings[extensionName], ...settingsToSave };
             saveSettingsDebounced(); // 调用 SillyTavern 的保存设置函数
             console.log(`${extensionName}: Settings saved (debounced).`);
        }, debounce_timeout.DEFAULT_SAVE_EDIT_TIMEOUT); // 使用 ST 提供的默认延迟时间
    }

    // 准备要保存的设置对象
    const settingsToSave = {
        apiMode: pluginSettings.apiMode,
        customApiUrl: pluginSettings.customApiUrl,
        customApiKey: pluginSettings.customApiKey, // 再次强调不建议在前端明文保存密钥
    };

    saveSettingsDebouncedLocal(settingsToSave); // 调用延迟保存函数
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
    responseOutput.html("<i>正在努力生成中...</i>"); // 显示加载状态

    let generatedText = "";
    let apiError = null;
    let responseData = null; // 用于存储原始响应数据

    try {
        if (pluginSettings.apiMode === "st_current_api") {
            console.log(`${extensionName}: Using SillyTavern's current API for raw prompt (via direct fetch).`);

            const mainApi = context.mainApi;
            let endpoint = '';
            let requestBody = {}; // 注意这里改名为 requestBody 以区分 fetch 参数
            const headers = context.getRequestHeaders(); // 获取 ST 的通用头部，包含 CSRF token

            // 根据不同的API构建请求体和确定端点
            switch (mainApi) {
                case 'kobold':
                case 'koboldhorde':
                case 'textgenerationwebui':
                case 'novel':
                     // Text Completion APIs
                     endpoint = context.getGenerateUrl(mainApi); // 使用 context.getGenerateUrl 获取端点
                     requestBody = {
                         prompt: prompt, // 发送用户输入作为原始提示
                         // 包含必要的生成参数
                         max_length: context.amountGen, // 使用 SillyTavern 配置的最大生成长度
                         temperature: power_user.temperature, // 示例：可以包含一些通用设置
                         top_p: power_user.top_p,
                         // 根据需要添加其他少量通用参数，但避免角色/上下文特定的
                     };
                     // 确保 headers 中有 Content-Type: application/json
                     headers['Content-Type'] = 'application/json';
                    break;
                case 'openai': // Chat Completion APIs
                    // 硬编码 OpenAI Chat Completion 端点
                    endpoint = '/api/openai/chat/completions';
                    // Chat Completion API 期望 messages 数组
                    requestBody = {
                        messages: [{ role: "user", content: prompt }],
                        // 使用 SillyTavern 的 OpenAI 配置参数
                        max_tokens: context.chatCompletionSettings.openai_max_tokens || 500,
                        temperature: context.chatCompletionSettings.openai_temperature,
                        top_p: context.chatCompletionSettings.openai_top_p,
                         // 如果需要指定模型，可以在这里添加，但通常由后端处理
                         // model: context.getChatCompletionModel(),
                    };
                    // 确保 headers 中有 Content-Type: application/json
                    headers['Content-Type'] = 'application/json';
                    break;
                default:
                    // 如果是其他未适配的API类型
                    apiError = `SillyTavern 当前配置的 API (${mainApi}) 不支持通过此插件模式直接发送原始提示。`;
                    throw new Error(apiError); // 抛出错误以进入catch块
            }

             // 发送请求
            console.log(`${extensionName}: Sending request to ${endpoint} with body:`, requestBody);
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: headers, // 使用 SillyTavern 的通用头部 (包含 CSRF token 和 Content-Type)
                body: JSON.stringify(requestBody), // 发送构建好的请求体
                signal: context.abortController?.signal, // 允许通过 ST 的停止按钮取消
            });

            if (!response.ok) {
                // 处理非2xx响应状态码 (例如 404, 500)
                let errorBody;
                try {
                    // 尝试解析JSON错误体，但要小心非JSON响应
                    errorBody = await response.json();
                } catch (e) {
                     console.warn(`${extensionName}: Failed to parse error response as JSON:`, e);
                    // 如果不是JSON响应，创建一个包含状态文本的简单对象
                    errorBody = { message: response.statusText || `HTTP Error ${response.status}` };
                }
                apiError = `API 返回错误 ${response.status}: ${errorBody.message || JSON.stringify(errorBody)}`;
                throw new Error(apiError); // 抛出错误以进入catch块
            }

            // 处理成功响应 (2xx状态码)
            responseData = await response.json(); // 获取响应数据

            // 使用 context.extractMessageFromData 提取文本，传入实际API类型以确保正确解析
            // extractMessageFromData 期望原始的响应体对象作为第一个参数
            generatedText = context.extractMessageFromData(responseData, mainApi);


            if (!generatedText) {
                apiError = `API (${mainApi}) 调用成功但未提取到文本内容。`;
                console.warn(`${extensionName}: API response did not contain extractable message. Response data:`, responseData);
                // 即使未提取到文本，也不抛出错误，在 finally 块显示结果
            }


        } else if (pluginSettings.apiMode === "custom_third_party") {
            // 保留原有的使用 TextCompletionService 的逻辑
            // 注意：这个分支仍然假设你的自定义API兼容 TextCompletionService
            // 如果不兼容，你可能需要在这里也直接使用 fetch 并完全控制请求体和端点
            const customApiUrl = pluginSettings.customApiUrl;
            const customApiKey = pluginSettings.customApiKey; // 注意：不建议在前端明文保存密钥

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
                        // TextCompletionService.generate 期望 prompt 和 options
                         responseData = await context.TextCompletionService.generate(
                            prompt,
                            requestOptions, // options 用于配置 api_server, api_key 等
                            context.abortController?.signal
                         );

                         // TextCompletionService 返回的 responseData 结构依赖于其内部实现
                         if (typeof responseData === 'string') {
                             generatedText = responseData; // TextCompletionService 可能直接返回文本
                         } else {
                              // 否则，尝试从响应数据中提取
                              // 对于自定义第三方API，通常假设是 generic 类型
                             generatedText = context.extractMessageFromData(responseData, 'generic');
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
                // 对于从API返回的文本，使用SillyTavern的格式化函数进行处理
                // messageFormatting 最后一个参数 (isReasoning) 应该根据需要设置，这里设为 false
                const formattedText = context.messageFormatting(generatedText, "AI", false, false, -1, {}, false);
                responseOutput.html(formattedText);
            } else {
                 // 如果没有提取到文本，显示错误信息或提示
                responseOutput.text(apiError || "生成成功，但未提取到文本内容。");
            }


        } catch (error) {
            // 捕获并显示错误
            console.error(`${extensionName}: Generation failed:`, error);
            let errorMessage = "生成失败。";
            // 优先使用抛出的 error 对象的 message 属性
            if (error.message) {
                 errorMessage = `生成失败: ${error.message}`;
            } else if (typeof error === 'string') {
                 errorMessage = `生成失败: ${error}`;
            } else if (apiError) {
                 errorMessage = `生成失败: ${apiError}`; // 使用在 try 块中构建的 apiError
            } else if (error instanceof Error) { // 捕获其他意外错误
                 errorMessage = `生成失败: ${error.name} - ${error.message}`;
            } else { // 捕获非 Error 类型的错误
                 errorMessage = `生成失败: 未知错误 (${JSON.stringify(error)})`;
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

        // 引入 debounce 函数（假设您已经引入了 utils.js 或有全局 debounce）
        // 如果没有，需要在此处定义或从其他地方导入
        // import { debounce } from '../../../../scripts/utils.js'; // 或者根据实际路径导入

        await loadPluginSettings(); // 加载并应用保存的设置

        // 事件绑定
        $('#adv_ai_api_mode').on('change', function() {
            pluginSettings.apiMode = $(this).val();
            toggleCustomApiConfigArea(pluginSettings.apiMode);
            savePluginSettings(); // 调用延迟保存
        });

        $('#adv_ai_custom_api_url').on('input', function() {
            pluginSettings.customApiUrl = $(this).val().trim();
            savePluginSettings(); // 调用延迟保存
        });

        $('#adv_ai_custom_api_key').on('input', function() {
            pluginSettings.customApiKey = $(this).val();
            savePluginSettings(); // 调用延迟保存
        });

        $('#adv_ai_generate_button').on('click', handleGenerate);

        console.log(`${extensionName}: Initialization complete.`);

    } catch (error) {
        console.error(`${extensionName}: Failed to initialize -`, error);
        toastr.error(`插件 ${extensionName} 初始化失败。详情请查看控制台。`);
    }
});
