// public/extensions/third-party/my-custom-ai-caller/index.js

// 确保从正确的相对路径导入
import { getContext } from '../../../../scripts/st-context.js';
import { renderExtensionTemplateAsync, extension_settings } from '../../../../scripts/extensions.js';
import { saveSettingsDebounced } from '../../../../script.js'; // saveSettingsDebounced 在主 script.js 中

const extensionName = "AI"; // 必须与文件夹名称匹配

// 插件的默认设置
const defaultSettings = {
    apiUrl: "",
    apiKey: "", // API密钥也存储在插件设置中
};

// 插件设置的本地副本
let pluginSettings = {};

/**
 * 加载插件设置
 */
async function loadPluginSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    // 合并默认设置和已保存设置
    pluginSettings = { ...defaultSettings, ...extension_settings[extensionName] };

    // 更新UI元素
    $('#custom_ai_api_url').val(pluginSettings.apiUrl);
    $('#custom_ai_api_key').val(pluginSettings.apiKey); // API密钥通常是敏感信息，但这里我们先简单处理
    console.log(`${extensionName}: Settings loaded.`, pluginSettings);
}

/**
 * 保存API URL设置
 */
function saveApiUrl() {
    const newUrl = $('#custom_ai_api_url').val().trim();
    if (pluginSettings.apiUrl !== newUrl) {
        pluginSettings.apiUrl = newUrl;
        extension_settings[extensionName].apiUrl = newUrl; // 更新全局设置对象
        saveSettingsDebounced();
        console.log(`${extensionName}: API URL saved.`);
    }
}

/**
 * 保存API Key设置
 */
function saveApiKey() {
    const newKey = $('#custom_ai_api_key').val().trim(); // 一般不直接trim密码，但这里为了演示
    if (pluginSettings.apiKey !== newKey) {
        pluginSettings.apiKey = newKey;
        extension_settings[extensionName].apiKey = newKey; // 更新全局设置对象
        saveSettingsDebounced();
        console.log(`${extensionName}: API Key saved.`);
    }
}


/**
 * 处理生成按钮点击
 */
async function handleGenerate() {
    const context = getContext(); // 获取SillyTavern上下文
    const apiUrl = pluginSettings.apiUrl;
    const apiKey = pluginSettings.apiKey; // 获取API密钥
    const prompt = $('#custom_ai_prompt_input').val().trim();

    if (!apiUrl) {
        toastr.error("请先在上方配置API URL。", "API URL缺失");
        return;
    }
    if (!prompt) {
        toastr.warning("请输入提示内容。", "提示为空");
        return;
    }

    const generateButton = $('#custom_ai_generate_button');
    const loadingSpinner = $('#custom_ai_loading_spinner');
    const responseOutput = $('#custom_ai_response_output');

    generateButton.prop('disabled', true);
    loadingSpinner.show();
    responseOutput.html("<i>正在努力生成中...</i>");

    try {
        // 构建传递给SillyTavern后端服务的选项
        // SillyTavern的TextCompletionService或ChatCompletionService会使用这些选项
        // 将请求代理到指定的api_server
        const requestOptions = {
            api_server: apiUrl, // 这是关键，告诉ST后端将请求发到这个URL
            // 在这里可以添加第三方API可能需要的其他参数
            // 例如：max_tokens, temperature, top_p 等
            // 这些参数的名称和格式需要与你的第三方API文档一致
            // SillyTavern的后端会尝试将这些参数传递给目标API
            // 对于API密钥，SillyTavern的内置服务通常不直接处理自定义API的密钥。
            // 如果API要求在Header中传递密钥（如 'Authorization: Bearer YOUR_KEY' 或 'X-Api-Key: YOUR_KEY'），
            // TextCompletionService 可能无法直接添加。
            // 一种常见做法是将密钥作为URL参数（如果API支持），或者使用更底层的 context.ConnectionManagerRequestService
            // (如果你的ST版本有并且你想自己构造完整的请求包括headers)。
            // 另一个选择是假设用户配置的apiUrl本身已经包含了必要的认证信息，或者该API不需要key。
            // 这里我们尝试将apiKey作为一个参数传递，某些后端或API包装器可能会识别它。
            ...(apiKey && { api_key: apiKey }), // 如果apiKey存在，则添加到options中
            // 你也可以尝试将apiKey放到其他可能的字段，如 'key', 'token'等，取决于API
        };

        console.log(`${extensionName}: Sending request to ${apiUrl} with options:`, requestOptions);

        // 使用SillyTavern的TextCompletionService通过其后端发送请求
        // 这比直接在前端fetch更安全，能处理CORS、CSRF等问题
        // `context.abortController?.signal` 用于允许用户通过ST的全局停止按钮来中止生成
        const responseData = await context.TextCompletionService.generate(
            prompt,
            requestOptions,
            context.abortController?.signal
        );

        console.log(`${extensionName}: Raw API response data:`, responseData);

        // context.extractMessageFromData 尝试从不同格式的API响应中提取主要文本
        let generatedText = context.extractMessageFromData(responseData);

        if (generatedText) {
            // 使用ST的messageFormatting来处理可能的Markdown等格式
            const formattedText = context.messageFormatting(generatedText, "AI", false, false, -1, {}, false);
            responseOutput.html(formattedText);
        } else {
            responseOutput.text("生成失败：API未返回可识别的文本内容。请检查API响应或控制台日志。");
            toastr.error("API未返回有效文本，请检查API配置或查看浏览器控制台获取更多信息。", "生成失败");
            console.error(`${extensionName}: API response did not contain extractable message. Response:`, responseData);
        }

    } catch (error) {
        console.error(`${extensionName}: API call failed:`, error);
        let errorMessage = "API 调用失败。";
        if (error.message) {
            errorMessage += ` 错误: ${error.message}`;
        } else if (typeof error === 'string') {
            errorMessage += ` ${error}`;
        } else if (error.error && error.error.message) { // 常见于OpenAI类错误
            errorMessage += ` ${error.error.message}`;
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
        // 优先尝试 #translation_container，这是较新ST版本中扩展设置的常见位置
        const container = $('#translation_container');
        if (container.length) {
            container.append(html);
        } else {
            // 回退到旧版可能使用的 #extensions_settings
            $('#extensions_settings').append(html);
        }
        console.log(`${extensionName}: UI injected.`);

        // 加载保存的设置
        await loadPluginSettings();

        // 绑定事件
        $('#custom_ai_api_url').on('input', saveApiUrl);
        $('#custom_ai_api_key').on('input', saveApiKey);
        $('#custom_ai_generate_button').on('click', handleGenerate);

        console.log(`${extensionName}: Initialization complete.`);

    } catch (error) {
        console.error(`${extensionName}: Failed to initialize -`, error);
        toastr.error(`插件 ${extensionName} 初始化失败。详情请查看控制台。`);
    }
});
