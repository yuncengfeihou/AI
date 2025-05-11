// public/extensions/third-party/AI/index.js

import { getContext } from '../../../../scripts/st-context.js';
import { renderExtensionTemplateAsync, extension_settings } from '../../../../scripts/extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { debounce_timeout } from '../../../../scripts/constants.js'; // 导入 debounce_timeout
// 导入 debounce 函数，通常在 utils.js 中
import { debounce } from '../../../../scripts/utils.js'; // <-- 确保 utils.js 的路径正确

// TavernHelper 全局对象由 JS-Slash-Runner/iframe_client.js 注入
// 可以在 iframe 中直接访问 window.TavernHelper
// 为了 TypeScript 类型提示或代码清晰，可以添加一个声明
// declare const TavernHelper: typeof window.TavernHelper; // 如果使用 TypeScript

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
             // 注意：直接修改 extension_settings[extensionName] 可能不是最佳实践
             // 但为了保持与您的原有代码风格一致，暂时这样处理。
             // 更安全的做法是深拷贝后再赋值。
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
    // apiError variable is less necessary when using generateRaw directly
    // as errors from the API call itself should be thrown by generateRaw.

    try {
        if (pluginSettings.apiMode === "st_current_api") {
            console.log(`${extensionName}: Using SillyTavern's current API via TavernHelper.generateRaw.`);

            // ====================================================================
            // *** 核心修改部分：调用 TavernHelper.generateRaw ***
            // generateRaw 允许通过 ordered_prompts 参数完全自定义发送给 API 的提示词结构
            // 这里我们只发送一个 role 为 'user' 的消息，内容就是用户输入的 prompt
            // generateRaw 会自动使用 SillyTavern 当前配置的 API (URL, Key, etc.)
            // 它也会触发 SillyTavern 的生成开始/结束事件，并处理流式传输（如果开启）
            // ====================================================================
            const generateConfig = {
                 // user_input is optional if the prompt is in ordered_prompts
                 // For clarity and strict control, define the entire structure
                 ordered_prompts: [
                     { role: 'user', content: prompt }
                 ],
                 // If you wanted to enable streaming for this plugin's generation:
                 // should_stream: true,
                 // You could then listen to iframe_events.STREAM_TOKEN_RECEIVED_*
                 // For this example, we just wait for the final result.

                 // No other parameters like overrides, injects, max_chat_history are needed
                 // as we want a pure raw prompt without ST's usual context building.
            };

            generatedText = await TavernHelper.generateRaw(generateConfig);
            // ====================================================================
            // *** 核心修改部分结束 ***
            // ====================================================================

            if (!generatedText) {
                 // generateRaw might return empty string in some cases (e.g., API returns empty)
                 // This is different from an error being thrown.
                 console.warn(`${extensionName}: generateRaw completed but returned empty text.`);
                 responseOutput.text("生成完成，但未返回任何文本。");
            } else {
                // Use ST's formatting function for the output before displaying
                // Pass appropriate arguments for messageFormatting
                // The message_id argument is often ignored for raw text formatting, so -1 is fine.
                const formattedText = context.messageFormatting(generatedText, "AI", false, false, -1, {}, false);
                responseOutput.html(formattedText);
            }


        } else if (pluginSettings.apiMode === "custom_third_party") {
            // ====================================================================
            // *** custom_third_party 模式下的逻辑保持不变 ***
            // TavernHelper.generateRaw 不能直接指定 API URL/Key，所以自定义模式需要自己处理
            // 您原有的逻辑似乎是使用 TextCompletionService，这里保持。
            // ====================================================================
             const customApiUrl = pluginSettings.customApiUrl;
             const customApiKey = pluginSettings.customApiKey;

             if (!customApiUrl) {
                throw new Error("请先配置自定义API URL。"); // Throw to be caught by the surrounding try...catch
             } else {
                 console.log(`${extensionName}: Using custom third-party API: ${customApiUrl} (via TextCompletionService).`);

                 // Assuming TextCompletionService.generate works for the custom API
                 // and sends the prompt as provided.
                 // If not, you would replace this with a custom fetch call
                 // manually building the request body expected by your specific custom API.
                 // Note: TextCompletionService.generate is also an abstraction over fetch,
                 // but its request body format depends on its internal logic for 'generic' type.
                 let responseData = null;
                 try {
                    responseData = await context.TextCompletionService.generate(
                        prompt, // Sending the raw prompt
                        {
                            api_server: customApiUrl,
                            ...(customApiKey && { api_key: customApiKey }), // Pass key if exists
                            prompt: prompt, // Send the raw prompt again? (Depending on TextCompletionService implementation for 'generic')
                            // You might need to add other parameters required by your custom API here,
                            // based on what TextCompletionService's 'generic' type supports or if you switch to direct fetch.
                            // Example: max_length: context.amountGen,
                        },
                        context.abortController?.signal // Allow cancellation via ST stop button
                    );

                     if (typeof responseData === 'string') {
                         generatedText = responseData; // TextCompletionService might return text directly
                     } else if (responseData) {
                          // Otherwise, try to extract message assuming a 'generic' response structure
                         generatedText = context.extractMessageFromData(responseData, 'generic');
                     } else {
                         // Handle case where TextCompletionService returns null/undefined or empty object
                         console.warn(`${extensionName}: TextCompletionService.generate completed but returned empty data.`);
                         generatedText = ""; // Set to empty to trigger the "no text" message below
                     }

                 } catch (e) {
                      // Catch errors specific to the TextCompletionService or custom fetch call
                      throw new Error(`自定义 API 调用失败: ${e.message || e}`); // Re-throw to be caught below
                 }


                 if (!generatedText) {
                     // Handle empty response from custom API
                     responseOutput.text("自定义API未返回可识别的文本内容。");
                     console.error(`${extensionName}: Custom API response did not contain extractable message or was unexpected. Response:`, responseData);
                 } else {
                      // Format the output using ST's function
                      const formattedText = context.messageFormatting(generatedText, "AI", false, false, -1, {}, false);
                      responseOutput.html(formattedText);
                 }
            }
        }

        // If we reached here without throwing, either generateRaw succeeded
        // or the custom_third_party mode succeeded (even if text was empty).
        // The generatedText (or lack thereof) has already been processed and displayed
        // inside the if/else blocks.

    } catch (error) {
        // Catch any errors thrown during generateRaw or custom API call setup/execution
        console.error(`${extensionName}: Generation failed:`, error);
        let errorMessage = "生成失败。"; // Default message
        if (error instanceof Error) {
             // Use the error's message if it's an Error object
             errorMessage = `生成失败: ${error.message}`;
        } else if (typeof error === 'string') {
             // If it's a string (less likely but possible)
             errorMessage = `生成失败: ${error}`;
        } else {
             // For other unexpected error types
             errorMessage = `生成失败: 未知错误 (${JSON.stringify(error)})`;
        }
        responseOutput.text(errorMessage); // Display error text
        toastr.error(errorMessage, "生成失败"); // Show toast notification
    } finally {
        // Ensure button is re-enabled and spinner is hidden regardless of success or failure
        generateButton.prop('disabled', false);
        loadingSpinner.hide();
        // Note: generateRaw should internally handle ST's global stop button state and progress indicator.
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
        // 已经在文件顶部添加了导入

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
