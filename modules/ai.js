/**
 * 根据用户的AI设置，判断内容是否符合意图并获取相关度评分。
 * @param {string} title - 网页的标题。
 * @param {object} settings - 从storage获取的完整设置对象。
 * @returns {Promise<{isAllowed: boolean, score: number}>} - 返回包含布尔值和评分的对象。
 */
export async function isContentAllowedByAI(title, settings) {
    const { ai_provider = 'gemini', ai_intent } = settings;
    console.log(`AI [${ai_provider.toUpperCase()}] 正在分析标题: "${title}"`);

    // 默认返回值，在出错时使用
    const fallbackResult = { isAllowed: true, score: -1 };

    if (!ai_intent) {
        console.log("AI场景/任务未设定，不进行AI分析。");
        return fallbackResult;
    }

    try {
        if (ai_provider === 'openai') {
            return await callOpenAI(title, ai_intent, settings);
        } else {
            return await callGemini(title, ai_intent, settings);
        }
    } catch (error) {
        console.error(`调用 ${ai_provider.toUpperCase()} API 时发生顶层错误:`, error);
        return fallbackResult;
    }
}

// --- Gemini API 调用逻辑 ---
async function callGemini(title, intent, settings) {
    const { api_key: apiKey } = settings;
    if (!apiKey) {
        console.warn("Gemini API密钥未设置。默认放行。");
        return { isAllowed: true, score: -1 };
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const prompt = getPrompt(intent, title);

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            // 要求Gemini返回JSON格式
            generationConfig: { response_mime_type: "application/json", maxOutputTokens: 100 }
        })
    });

    if (!response.ok) {
        console.error("Gemini API 响应失败:", response.status, await response.text());
        return { isAllowed: true, score: -1 };
    }

    const data = await response.json();
    const rawText = data.candidates[0].content.parts[0].text;
    return parseAIResponse(rawText);
}

// --- OpenAI API 调用逻辑 ---
async function callOpenAI(title, intent, settings) {
    const { openai_api_url: baseUrl, openai_api_key: apiKey, openai_model: model } = settings;
    if (!baseUrl || !apiKey || !model) {
        console.warn("OpenAI 配置不完整。默认放行。");
        return { isAllowed: true, score: -1 };
    }
    const apiUrl = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const prompt = getPrompt(intent, title);

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: prompt }],
            // 要求OpenAI返回JSON格式
            response_format: { type: "json_object" },
            max_tokens: 100,
            temperature: 0.0
        })
    });

    if (!response.ok) {
        console.error("OpenAI API 响应失败:", response.status, await response.text());
        return { isAllowed: true, score: -1 };
    }
    
    const data = await response.json();
    const rawText = data.choices[0].message.content;
    return parseAIResponse(rawText);
}

/**
 * 解析AI返回的JSON字符串。
 * @param {string} rawText - AI返回的原始文本。
 * @returns {{isAllowed: boolean, score: number}}
 */
function parseAIResponse(rawText) {
    try {
        console.log("AI 原始回答:", rawText);
        const result = JSON.parse(rawText);
        const decision = result.decision || '否';
        const score = result.score !== undefined ? parseInt(result.score, 10) : 0;
        
        const finalResult = {
            isAllowed: decision.includes('是'),
            score: Math.max(0, Math.min(100, score)) // 确保分数在0-100之间
        };
        console.log("解析后的结果:", finalResult);
        return finalResult;
    } catch (error) {
        console.error("解析AI JSON响应时出错:", error);
        // 如果解析失败，采取最严格的措施：拦截
        return { isAllowed: false, score: 0 };
    }
}


/**
 * 生成统一的、优化的Prompt。
 * @param {string} intent - 用户的场景任务，可能包含多个，用逗号分隔。
 * @param {string} title - 网页标题。
 * @returns {string} - 返回构造好的Prompt。
 */
function getPrompt(intent, title) {
    return `
# 角色
你是一位顶级的“首席专注官”，专精于评估数字信息与用户意图的匹配度。你的回答必须是结构完整的JSON对象。

# 核心指令
1.  **评估标准**：严格根据“场景任务列表”评估“网页标题”。只要标题内容与列表中的 **任意一个** 任务高度相关，就应被视为符合场景。
2.  **唯一输出**：你的最终回答 **必须** 是一个结构完整的JSON对象，包含 "decision" (string: "是" 或 "否") 和 "score" (number: 0-100) 两个键。

# 知识库
- **高相关性来源 (判定为“是”，分数95)**: Google, Bing, 维基百科, Stack Overflow, 知乎, GitHub, CSDN, 官方文档, Google Docs, Notion, Figma, Trello。
- **负面约束**:
    - **娱乐/分心内容 (分数-30)**: YouTube, TikTok, Bilibili, 游戏, 电视剧, 电影, Facebook, Instagram。
    - **点击诱饵 (分数-50)**: “震惊!”, “你绝对想不到...”, “秘密揭晓”。

# 任务
- **场景任务列表:** ${intent}
- **网页标题:** ${title}

请输出你的JSON评估结果。

# 示例

## 示例1: 单一任务
- **场景任务列表:** "学习如何使用React Hooks"
- **网页标题:** "useEffect Hook - React 官方文档"
- **期望输出:**
  \`\`\`json
  {
    "decision": "是",
    "score": 100
  }
  \`\`\`

## 示例2: 多任务 (关键示例)
- **场景任务列表:** "学习Vue, 查询Element Plus文档"
- **网页标题:** "Button 按钮 | Element Plus"
- **期望输出:**
  \`\`\`json
  {
    "decision": "是",
    "score": 100
  }
  \`\`\`

## 示例3: 应用负面约束
- **场景任务列表:** "了解最新的AI技术进展"
- **网页标题:** "这个真好吃！- YouTube"
- **期望输出:**
  \`\`\`json
  {
    "decision": "否",
    "score": 0
  }
  \`\`\`

## 示例4: 应用高相关性来源规则
- **场景任务列表:** "解决Python 'KeyError'"
- **网页标题:** "python - What is a KeyError? - Stack Overflow"
- **期望输出:**
  \`\`\`json
  {
    "decision": "是",
    "score": 95
  }
  \`\`\`
`;
}