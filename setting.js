document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 元素获取 ---
    const aiProviderSelect = document.getElementById('aiProviderSelect');
    
    // Gemini
    const geminiSettings = document.getElementById('gemini-settings');
    const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
    const saveGeminiApiKeyBtn = document.getElementById('saveGeminiApiKeyBtn');

    // OpenAI
    const openaiSettings = document.getElementById('openai-settings');
    const openaiApiUrlInput = document.getElementById('openaiApiUrlInput');
    const openaiApiKeyInput = document.getElementById('openaiApiKeyInput');
    const openaiModelSelect = document.getElementById('openaiModelSelect');
    const fetchModelsBtn = document.getElementById('fetchModelsBtn');
    const saveOpenaiSettingsBtn = document.getElementById('saveOpenaiSettingsBtn');

    // 数据管理
    const clearWhitelistBtn = document.getElementById('clearWhitelistBtn');
    const clearPassesBtn = document.getElementById('clearPassesBtn');

    // --- 事件处理函数 ---

    // UI更新函数
    const updateVisibleSettings = (provider) => {
        geminiSettings.style.display = (provider === 'gemini') ? 'block' : 'none';
        openaiSettings.style.display = (provider === 'openai') ? 'block' : 'none';
    };
    
    // 切换AI提供商
    const handleProviderChange = () => {
        const provider = aiProviderSelect.value;
        chrome.storage.local.set({ ai_provider: provider }, () => {
            updateVisibleSettings(provider);
            alert(`AI 提供商已切换为: ${provider.toUpperCase()}`);
        });
    };

    // 保存 Gemini API 密钥
    const handleSaveGeminiApiKey = () => {
        const apiKey = geminiApiKeyInput.value.trim();
        if (apiKey) {
            chrome.storage.local.set({ api_key: apiKey }, () => {
                geminiApiKeyInput.value = "";
                geminiApiKeyInput.placeholder = "新 Gemini 密钥已保存！";
                alert("Gemini API 密钥已成功保存。");
            });
        } else {
            alert("请输入有效的 Gemini API 密钥！");
        }
    };

    // 从 OpenAI 获取模型
    const handleFetchOpenAIModels = async () => {
        const baseUrl = openaiApiUrlInput.value.trim();
        const apiKey = openaiApiKeyInput.value.trim() || openaiApiKeyInput.placeholder;

        if (!baseUrl || !apiKey || apiKey === "OpenAI API 密钥已设定") {
            alert("请先输入 OpenAI API 基础地址和有效的密钥。");
            return;
        }

        fetchModelsBtn.textContent = '获取中...';
        fetchModelsBtn.disabled = true;

        try {
            const response = await fetch(`${baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API 请求失败 (${response.status}): ${errorData.error.message}`);
            }

            const data = await response.json();
            const models = data.data.filter(m => m.id.includes('gpt')).map(m => m.id).sort();

            openaiModelSelect.innerHTML = '<option value="">-- 请选择一个模型 --</option>';
            models.forEach(modelId => {
                const option = new Option(modelId, modelId);
                openaiModelSelect.appendChild(option);
            });
            openaiModelSelect.disabled = false;
            saveOpenaiSettingsBtn.disabled = false;
            alert(`成功获取 ${models.length} 个模型！请选择并保存。`);

        } catch (error) {
            alert(`获取模型失败：${error.message}`);
        } finally {
            fetchModelsBtn.textContent = '获取模型';
            fetchModelsBtn.disabled = false;
        }
    };

    // 保存 OpenAI 设置
    const handleSaveOpenaiSettings = () => {
        const newApiKey = openaiApiKeyInput.value.trim();
        const settingsToSave = {
            openai_api_url: openaiApiUrlInput.value.trim(),
            openai_model: openaiModelSelect.value
        };

        if (newApiKey) {
            settingsToSave.openai_api_key = newApiKey;
        }

        if (!settingsToSave.openai_api_url) {
            alert("API基础地址不能为空！");
            return;
        }
        if (!settingsToSave.openai_model) {
            alert("请选择一个模型！");
            return;
        }
        
        chrome.storage.local.set(settingsToSave, () => {
            if (newApiKey) {
                openaiApiKeyInput.value = "";
                openaiApiKeyInput.placeholder = "新 OpenAI 密钥已保存！";
            }
            alert("OpenAI 设置已成功保存。");
        });
    };
    
    // 清空永久白名单
    const handleClearWhitelist = () => {
        if (confirm("确定要清空所有永久信任的网站吗？此操作不可撤销。")) {
            chrome.storage.local.set({ ai_permanent_whitelist: [] }, () => {
                alert("永久白名单已清空。");
            });
        }
    };

    // 清除临时通行证
    const handleClearPasses = () => {
        if (confirm("确定要清除所有网站的临时通行证吗？")) {
            chrome.storage.local.set({ ai_temporary_pass: {} }, () => {
                alert("所有临时通行证已被清除。");
            });
        }
    };

    // --- 初始化函数 ---
    const initialize = async () => {
        const data = await chrome.storage.local.get([
            'ai_provider',
            'api_key',
            'openai_api_url',
            'openai_api_key',
            'openai_model'
        ]);

        // 1. 设置提供商下拉菜单
        aiProviderSelect.value = data.ai_provider || 'gemini';
        
        // 2. 更新UI显示
        updateVisibleSettings(aiProviderSelect.value);

        // 3. 填充已保存的值
        if (data.api_key) geminiApiKeyInput.placeholder = "Gemini API 密钥已设定";
        if (data.openai_api_url) openaiApiUrlInput.value = data.openai_api_url;
        if (data.openai_api_key) openaiApiKeyInput.placeholder = "OpenAI API 密钥已设定";
        if (data.openai_model) {
            const option = new Option(data.openai_model, data.openai_model, true, true);
            openaiModelSelect.appendChild(option);
            openaiModelSelect.disabled = false;
            saveOpenaiSettingsBtn.disabled = false;
        }

        // --- 事件监听器绑定 ---
        aiProviderSelect.addEventListener('change', handleProviderChange);
        
        saveGeminiApiKeyBtn.addEventListener('click', handleSaveGeminiApiKey);
        geminiApiKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSaveGeminiApiKey(); });

        fetchModelsBtn.addEventListener('click', handleFetchOpenAIModels);
        saveOpenaiSettingsBtn.addEventListener('click', handleSaveOpenaiSettings);

        clearWhitelistBtn.addEventListener('click', handleClearWhitelist);
        clearPassesBtn.addEventListener('click', handleClearPasses);
    };

    // --- 启动 ---
    initialize();
});