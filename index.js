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
    responseOutput.html("<i>正在努力生成中...</i>"); // 使用 html 允许斜体

    let generatedText = "";
    let apiError = null;

    try {
        if (pluginSettings.apiMode === "st_current_api") {
            console.log(`${extensionName}: Using SillyTavern's current API for raw prompt (via direct fetch).`);

            const mainApi = context.mainApi;
            let endpoint = '';
            let requestData = {};
            const headers = context.getRequestHeaders();

            // 根据不同的API类型构建请求体和确定端点
            switch (mainApi) {
                case 'kobold':
                case 'koboldhorde':
                case 'textgenerationwebui':
                case 'novel':
                    // 这些通常是 Text Completion API 或其代理
                    endpoint = `/api/backends/${mainApi}/generate`; // 文本补全后端通用端点
                    requestData = {
                        prompt: prompt,
                        max_length: context.amountGen, // 使用ST配置的最大生成长度
                        // 可以选择性添加一些通用参数，但尽量保持简单
                        temperature: power_user.temperature,
                        top_p: power_user.top_p,
                        // 注意：不包含任何角色卡、历史等信息
                    };
                     if (mainApi === 'textgenerationwebui') {
                         // textgenerationwebui 代理会根据其内部配置处理 api_server 等
                         // 不需要在这里 explicitly 添加
                     } else if (mainApi === 'kobold' || mainApi === 'koboldhorde') {
                         // Kobold 系列可能需要 api_server，但通常由后端代理自动处理
                         // 这里为了最小化，不添加，依赖后端代理的默认行为
                     } else if (mainApi === 'novel') {
                         // NovelAI 代理处理密钥和模型，这里只提供提示和长度
                     }
                    break;
                case 'openai':
                    // OpenAI (以及通过ST代理的Chat Completion API)
                    // 端点不同，请求体格式也不同
                    endpoint = '/api/openai/chat/completions'; // Chat Completion API 端点
                    requestData = {
                        messages: [{ role: "user", content: prompt }], // Chat Completion 格式
                        max_tokens: context.chatCompletionSettings.openai_max_tokens || 500, // 使用OAI配置的最大令牌数
                        temperature: context.chatCompletionSettings.openai_temperature, // 使用OAI特定设置
                        top_p: context.chatCompletionSettings.openai_top_p,
                        // model 通常由ST后端根据OAI配置页面选择的模型自动处理
                        // 如果需要强制指定模型，可以添加 model: "your-model-name"
                    };
                    // OpenAI 不需要设置 'Content-Type': 'application/json' 之外的其他头部
                    // SillyTavern 后端会自动处理 CSRF token 等
                    break;
                default:
                    // 如果是其他未适配的API类型
                    apiError = `SillyTavern 当前配置的 API (${mainApi}) 不支持通过此插件发送原始提示。`;
                    throw new Error(apiError); // 抛出错误以进入catch块
            }

             // 检查端点是否已确定
             if (!endpoint) {
                 apiError = `无法确定当前 API (${mainApi}) 的生成端点。`;
                 throw new Error(apiError);
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
                    // 如果响应不是JSON，直接使用状态文本作为错误信息
                    errorBody = { message: response.statusText || `HTTP error! status: ${response.status}` };
                }
                apiError = `API 返回错误 ${response.status}: ${errorBody.message || JSON.stringify(errorBody)}`;
                throw new Error(apiError); // 抛出错误以进入catch块
            }

            // 处理成功响应
            const responseData = await response.json();

            // 使用 context.extractMessageFromData 提取文本，传入实际API类型以确保正确解析
            // 对于 OpenAI，需要传入 'openai' 而不是具体的 Chat Completion Source (如 'google')
            // 因为 extractMessageFromData 内部逻辑只认 'openai' 来处理 messages 数组
            const extractionApiType = mainApi === 'openai' ? 'openai' : mainApi;
            generatedText = context.extractMessageFromData(responseData, extractionApiType);

            if (!generatedText) {
                apiError = `API ${mainApi} 调用成功但未提取到文本内容。请检查控制台查看完整响应。`;
                console.warn(`${extensionName}: API response did not contain extractable message. Response:`, responseData);
                // 即使未提取到文本，也不抛出错误，让responseOutput显示空结果或警告
            }


        } else if (pluginSettings.apiMode === "custom_third_party") {
            // 保留原有的使用 TextCompletionService 的逻辑，
            // 但要注意 TextCompletionService 主要用于封装 Text Completion 后端
            const customApiUrl = pluginSettings.customApiUrl;
            const customApiKey = pluginSettings.customApiKey;

            if (!customApiUrl) {
                apiError = "请先配置自定义API URL。";
                throw new Error(apiError);
            } else {
                console.log(`${extensionName}: Using custom third-party API: ${customApiUrl}`);
                // TextCompletionService 期望的参数结构可能与后端实际需要的有出入
                // 如果自定义API不兼容 TextCompletionService 的封装，可能需要直接使用 fetch
                const requestOptions = {
                    api_server: customApiUrl,
                    ...(customApiKey && { api_key: customApiKey }),
                    prompt: prompt,
                    max_length: context.amountGen,
                    temperature: power_user.temperature,
                    top_p: power_user.top_p,
                    // ... 其他参数
                };

                try {
                     const responseData = await context.TextCompletionService.generate(
                        prompt,
                        requestOptions,
                        context.abortController?.signal // 允许取消
                     );
                     // TextCompletionService.generate 返回的数据结构取决于其内部封装的后端类型
                     // 尝试使用 extractMessageFromData，可能需要猜测或知道其封装的后端类型
                     // 这里假设它返回的数据结构类似 textgenerationwebui 或 generic
                     generatedText = context.extractMessageFromData(responseData);
                     if (!generatedText) {
                         apiError = "自定义API未返回可识别的文本内容。请检查控制台查看完整响应。";
                         console.error(`${extensionName}: Custom API response did not contain extractable message. Response:`, responseData);
                     }
                } catch (e) {
                     apiError = `Custom API call failed: ${e.message || e}`;
                     console.error(`${extensionName}: Custom API fetch failed:`, e);
                     throw e; // 抛出错误以进入catch块
                }
            }
        }

        // 显示结果
        if (generatedText) {
            // 对于从API返回的文本，使用SillyTavern的格式化函数进行处理
            // 传递 null 作为 messageId 可以避免一些与消息ID相关的逻辑，因为这不是聊天中的消息
            const formattedText = context.messageFormatting(generatedText, "AI", false, false, null, {}, false);
            responseOutput.html(formattedText);
        } else {
            // 如果没有提取到文本，显示一个提示（如果apiError已设置，它会显示）
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
        } else {
             errorMessage += ` 未知错误: ${JSON.stringify(error)}`;
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
