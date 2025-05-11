// public/extensions/third-party/my-advanced-ai-caller/index.js

import { getContext } from '../../../../scripts/st-context.js';
import { renderExtensionTemplateAsync, extension_settings } from '../../../../scripts/extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const extensionName = "my-advanced-ai-caller";

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
    pluginSettings.customApiKey = $(this).val(); // 一般不trim密码
    savePluginSettings();
});


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
            console.log(`${extensionName}: Using SillyTavern's current API to generate.`);
            // 使用 context.generateQuietPrompt 来调用SillyTavern当前配置的API
            // quietToLoud = true (我们想要一个明确的回复)
            // skipWIAN = true (通常对于独立调用，我们不希望注入世界信息或作者笔记)
            // quietName = null (使用默认或让ST处理)
            // responseLength = null (使用ST的当前设置)
            generatedText = await context.generateQuietPrompt(prompt, true, true, null, null, null, null);

            if (!generatedText && context.onlineStatus === 'no_connection') {
                 apiError = "SillyTavern当前API未连接或生成失败。";
            } else if (!generatedText) {
                 apiError = "SillyTavern当前API已连接但未返回文本。";
            }

        } else if (pluginSettings.apiMode === "custom_third_party") {
            const customApiUrl = pluginSettings.customApiUrl;
            const customApiKey = pluginSettings.customApiKey;

            if (!customApiUrl) {
                toastr.error("请先配置自定义API URL。", "自定义API URL缺失");
                apiError = "自定义API URL未配置。"; // 设置错误以便finally块不尝试处理空文本
            } else {
                console.log(`${extensionName}: Using custom third-party API: ${customApiUrl}`);
                const requestOptions = {
                    api_server: customApiUrl,
                    // 尝试将apiKey作为参数传递，具体效果取决于SillyTavern后端和目标API
                    ...(customApiKey && { api_key: customApiKey }),
                    // 你可能需要根据你的API添加其他参数，例如：
                    // model: "your-specific-model-if-needed-by-the-api-proxy"
                    // temperature: 0.7,
                    // max_tokens: 200,
                };

                const responseData = await context.TextCompletionService.generate(
                    prompt,
                    requestOptions,
                    context.abortController?.signal
                );
                generatedText = context.extractMessageFromData(responseData);
                if (!generatedText) {
                    apiError = "自定义API未返回可识别的文本内容。";
                    console.error(`${extensionName}: Custom API response did not contain extractable message. Response:`, responseData);
                }
            }
        }

        if (apiError) {
            throw new Error(apiError); // 抛出错误以便被catch块捕获
        }

        if (generatedText) {
            const formattedText = context.messageFormatting(generatedText, "AI", false, false, -1, {}, false);
            responseOutput.html(formattedText);
        } else {
            // 这个分支理论上不应该被大量触发，因为上面已经检查了!generatedText
            responseOutput.text("生成成功，但未提取到文本内容。");
        }

    } catch (error) {
        console.error(`${extensionName}: Generation failed:`, error);
        let errorMessage = "API 调用失败。";
        if (error.message) {
            errorMessage += ` 错误: ${error.message}`;
        } else if (typeof error === 'string') {
            errorMessage += ` ${error}`;
        }
        responseOutput.text(errorMessage);
        toastr.error(errorMessage, "生成失败");
    } finally {
        generateButton.prop('disabled', false);
        loadingSpinner.hide();
    }
}

// DOM加载完成后执行
jQuery(async () => {
    console.log(`${extensionName}: Initializing...`);

    try {
        const html = await renderExtensionTemplateAsync(`third-party/${extensionName}`, 'settings_ui');
        const container = $('#translation_container'); // 优先使用较新ST版本的容器
        if (container.length) {
            container.append(html);
        } else {
            $('#extensions_settings').append(html); // 回退
        }
        console.log(`${extensionName}: UI injected.`);

        await loadPluginSettings(); // 加载并应用保存的设置

        // 事件绑定现在在各自的函数作用域内或在loadPluginSettings之后完成
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
