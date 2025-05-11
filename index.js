// public/extensions/third-party/my-ai-tool-plugin/index.js

// 注意：导入路径可能需要根据你的 SillyTavern 版本和文件结构进行调整
// 确保从正确的相对路径导入 getContext 和 renderExtensionTemplateAsync
import { getContext } from '../../../st-context.js'; // 从 st-context.js 导入 getContext
import { renderExtensionTemplateAsync, extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../script.js'; // 从 script.js 导入 saveSettingsDebounced

// 插件文件夹名称，务必与 manifest.json 中的名称以及实际文件夹名一致！
const extensionName = "AI";

// 插件的默认设置
const defaultSettings = {
    apiUrl: "", // 默认API URL为空
};

// 获取插件的设置对象（在 SillyTavern 加载插件时会自动初始化 extension_settings）
// 在 jQuery(async () => { ... }) 内部访问 extension_settings[extensionName] 更安全
let pluginSettings = {}; // 稍后在 jQuery 回调中初始化

/**
 * 加载插件设置并合并默认值
 */
async function loadSettings() {
    // 确保插件设置对象存在
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    // 合并默认设置，确保所有设置项都有值 (已有的设置不会被覆盖)
    Object.assign(extension_settings[extensionName], {
        ...defaultSettings, // 先放默认值
        ...extension_settings[extensionName], // 再放用户已保存的值
    });
    // 将全局设置对象的引用赋给局部变量，方便访问
    pluginSettings = extension_settings[extensionName];

    console.log(`插件 ${extensionName}: 设置加载完成`, pluginSettings);
}

/**
 * 保存API URL设置
 */
function saveApiUrlSetting() {
    const newUrl = $('#my_ai_tool_api_url').val().trim();
    if (pluginSettings.apiUrl !== newUrl) {
        pluginSettings.apiUrl = newUrl;
        saveSettingsDebounced(); // 调用防抖保存函数
        console.log(`插件 ${extensionName}: API URL 设置已更新并保存`);
    }
}

/**
 * 处理生成按钮点击事件
 */
async function handleGenerateClick() {
    const context = getContext(); // 获取 SillyTavern 上下文
    const apiUrl = pluginSettings.apiUrl; // 从设置中获取API URL
    const prompt = $('#my_ai_tool_prompt_input').val().trim(); // 获取输入的Prompt

    // 简单的输入验证
    if (!apiUrl) {
        toastr.error("请在设置中填写API URL。", "API URL 缺失");
        return;
    }
    if (!prompt) {
        toastr.warning("请输入要生成的内容。", "Prompt 为空");
        return;
    }

    // 获取 UI 元素，用于显示状态和结果
    const generateButton = $('#my_ai_tool_generate_button');
    const loadingSpinner = $('#my_ai_tool_loading_spinner');
    const responseOutput = $('#my_ai_tool_response_output');

    // 更新 UI 状态：禁用按钮，显示加载动画
    generateButton.prop('disabled', true);
    loadingSpinner.show();
    responseOutput.text("正在生成..."); // 显示生成中状态

    try {
        // 使用 SillyTavern 的 TextCompletionService 通过后端发送请求
        // TextCompletionService 适用于只需要发送 Prompt 并接收文本回复的第三方API
        // 如果API需要更复杂的请求结构 (如聊天消息数组)，可能需要使用 ChatCompletionService
        // 或直接通过 ST 后端发送自定义请求 (这更复杂，通常 TextCompletionService/ChatCompletionService 已足够)

        // TextCompletionService.generate 的参数通常是 prompt 字符串 和 options 对象
        // options 对象中可以包含 api_server (即第三方API的URL) 以及其他API可能需要的参数
        // ST 后端会负责将这些参数以及 Prompt 按照配置发送到指定的 api_server
        const responseData = await context.TextCompletionService.generate(
            prompt,
            {
                api_server: apiUrl,
                // 您可以在这里添加其他 API 可能需要的参数，例如:
                // max_length: 200,
                // temperature: 0.7,
                // stopping_strings: ["\nUser:", "\nAssistant:"],
                // 注意：这些参数需要根据您的第三方API实际支持的参数名来填写
            },
            context.abortController?.signal // 传递当前的 abort signal，允许用户通过 ST 的停止按钮取消生成
        );

        console.log("API 原始回复数据:", responseData);

        // 从 API 回复数据中提取文本内容
        // context.extractMessageFromData 是一个内置函数，可以尝试从不同API格式中提取文本
        const generatedText = context.extractMessageFromData(responseData);

        if (generatedText) {
            // 使用 messageFormatting 函数对回复进行格式化（例如 Markdown）
            // 参数: 消息文本, 角色名(这里可以为空), 是否系统消息, 是否用户消息, 消息ID(这里可以随意), Sanitizer选项, 是否Reasoning
            const formattedText = context.messageFormatting(generatedText, "", false, false, -1, {}, false);
            responseOutput.html(formattedText); // 使用 html() 以便渲染 Markdown
        } else {
             responseOutput.text("生成失败：API未返回文本内容。");
             toastr.error("API未返回文本内容，请检查API配置或回复格式。", "生成失败");
        }

    } catch (error) {
        console.error("API 调用失败:", error);
        let errorMessage = "API 调用失败。";
        if (error.message) {
            errorMessage += ` 错误信息: ${error.message}`;
        } else if (error.response) {
             errorMessage += ` 错误信息: ${JSON.stringify(error.response)}`;
        }
        responseOutput.text(errorMessage);
        toastr.error(errorMessage, "生成失败");
    } finally {
        // 恢复 UI 状态：启用按钮，隐藏加载动画
        generateButton.prop('disabled', false);
        loadingSpinner.hide();
    }
}


// SillyTavern 加载完成后执行主逻辑
jQuery(async () => {
    console.log(`插件 ${extensionName} 开始初始化...`);

    // 1. 加载 HTML 模板并注入到扩展设置区域
    try {
        // 加载 settings_ui.html 的内容
        const settingsHtml = await renderExtensionTemplateAsync(`third-party/${extensionName}`, 'settings_ui');

        // 将加载的 HTML 追加到 SillyTavern 的扩展设置区域
        // 目标容器通常是 '#translation_container' 或 '#extensions_settings'
        // 优先尝试 '#translation_container'
        const targetContainer = $('#translation_container');
        if (targetContainer.length) {
             targetContainer.append(settingsHtml);
             console.log(`插件 ${extensionName}: 已添加设置界面到 #translation_container`);
        } else {
             // 如果 #translation_container 不存在，尝试 #extensions_settings
             $('#extensions_settings').append(settingsHtml);
             console.log(`插件 ${extensionName}: 已添加设置界面到 #extensions_settings`);
        }


    } catch (error) {
        console.error(`插件 ${extensionName}: 加载或注入 settings_ui.html 失败:`, error);
        toastr.error(`插件 ${extensionName} 加载界面失败。`);
        return; // 如果界面加载失败，停止后续初始化
    }

    // 2. 加载插件设置并更新 UI 上的设置字段
    await loadSettings(); // 等待设置加载完成

    // 使用加载的设置值更新 API URL 输入框
    $('#my_ai_tool_api_url').val(pluginSettings.apiUrl);


    // 3. 为 UI 元素绑定事件监听器
    // 绑定 API URL 输入框的 input 事件，用于实时保存设置
    $('#my_ai_tool_api_url').on('input', saveApiUrlSetting);

    // 绑定生成按钮的点击事件
    $('#my_ai_tool_generate_button').on('click', handleGenerateClick);

    console.log(`插件 ${extensionName} 初始化完成。`);
});
