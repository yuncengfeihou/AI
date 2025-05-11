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

// $('#adv_ai_api_mode').on('change', function() { // Moved to jQuery ready
//     pluginSettings.apiMode = $(this).val();
//     toggleCustomApiConfigArea(pluginSettings.apiMode);
//     savePluginSettings();
// });

// $('#adv_ai_custom_api_url').on('input', function() { // Moved to jQuery ready
//     pluginSettings.customApiUrl = $(this).val().trim();
//     savePluginSettings();
// });

// $('#adv_ai_custom_api_key').on('input', function() { // Moved to jQuery ready
//     pluginSettings.customApiKey = $(this).val();
//     savePluginSettings();
// });


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
            console.log(`${extensionName}: Using SillyTavern's current API to generate with raw prompt.`);
            // 使用 context.generateRaw 来发送原始提示词
            // prompt: 用户的输入
            // api: null (或 context.mainApi) 表示使用SillyTavern当前配置的API
            // instructOverride: true - 强制不使用当前ST的instruct模式封装，直接发送prompt
            // quietToLoud: true - 确保我们得到一个直接的回复，而不是静默的背景行为
            // systemPrompt: null - 不附加任何系统提示
            // responseLength: null - 使用ST的当前设置
            // trimNames: true - 通常是个好选择
            generatedText = await context.generateRaw(prompt, null, true, true, null, null, true);

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
                apiError = "自定义API URL未配置。";
            } else {
                console.log(`${extensionName}: Using custom third-party API: ${customApiUrl}`);
                const requestOptions = {
                    api_server: customApiUrl,
                    ...(customApiKey && { api_key: customApiKey }),
                    // 根据需要，你可能需要在此处添加其他参数
                    // temperature: 0.7,
                    // max_tokens: 200, // SillyTavern 的 textCompletionService 似乎没有直接传递这些
                                     // 它更侧重于使用已有的SillyTavern参数结构。
                                     // 如果自定义API需要这些，你可能需要修改 TextCompletionService 的行为
                                     // 或者确保你的自定义API代理服务器能处理SillyTavern发送的标准参数。
                };

                // 注意: SillyTavern的TextCompletionService.generate可能不会像你期望的那样
                // 灵活地处理任意第三方API的参数。它主要用于封装对类Ooba/KoboldCPP后端的调用。
                // 如果你的自定义API有非常不同的格式，你可能需要直接使用 fetch。
                // 但这里我们假设它能与SillyTavern的textgen-settings.js中的 "generic" 类型兼容。
                const responseData = await context.TextCompletionService.generate(
                    prompt,
                    requestOptions,
                    context.abortController?.signal // 允许取消
                );
                generatedText = context.extractMessageFromData(responseData); // 尝试从响应中提取文本
                if (!generatedText) {
                    apiError = "自定义API未返回可识别的文本内容。";
                    console.error(`${extensionName}: Custom API response did not contain extractable message. Response:`, responseData);
                }
            }
        }

        if (apiError) {
            throw new Error(apiError);
        }

        if (generatedText) {
            // 对于从API返回的文本，使用SillyTavern的格式化函数进行处理
            const formattedText = context.messageFormatting(generatedText, "AI", false, false, -1, {}, false);
            responseOutput.html(formattedText);
        } else {
            // 如果到这里generatedText仍然为空，说明API调用了但没提取出东西
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
        const container = $('#translation_container');
        if (container.length) {
            container.append(html);
        } else {
            $('#extensions_settings').append(html);
        }
        console.log(`${extensionName}: UI injected.`);

        await loadPluginSettings();

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
