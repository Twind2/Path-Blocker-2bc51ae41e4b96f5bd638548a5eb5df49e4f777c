document.addEventListener('DOMContentLoaded', function() {
    // --- 获取所有需要的DOM元素 ---
    const focusScoreEl = document.getElementById('focusScore');
    const modeHardcoreBtn = document.getElementById('modeHardcore');
    const modeHybridBtn = document.getElementById('modeHybrid');
    const modeAiBtn = document.getElementById('modeAi');
    const sceneControlArea = document.querySelector('.scene-control-area');
    
    // 场景管理元素
    const sceneSelect = document.getElementById('sceneSelect');
    const addSceneBtn = document.getElementById('addSceneBtn');
    const editSceneBtn = document.getElementById('editSceneBtn');
    const deleteSceneBtn = document.getElementById('deleteSceneBtn');
    const exportSceneBtn = document.getElementById('exportSceneBtn');
    const importSceneBtn = document.getElementById('importSceneBtn');

    // 场景编辑器模态框元素
    const sceneEditorModal = document.getElementById('scene-editor-modal');
    const modalTitle = document.getElementById('modal-title');
    const sceneNameInput = document.getElementById('scene-name-input');
    const tasksContainer = document.getElementById('tasks-container');
    const addTaskBtn = document.getElementById('add-task-btn');
    const saveSceneBtn = document.getElementById('save-scene-btn');
    const cancelSceneBtn = document.getElementById('cancel-scene-btn');
    let editingSceneName = null; // 用于存储正在编辑的场景的原名

    // 规则锁定元素
    const nameInput = document.getElementById('nameInput');
    const pathInput = document.getElementById('pathInput');
    const groupSelect = document.getElementById('groupSelect');
    const addBtn = document.getElementById('addBtn');
    const addCurrentPageBtn = document.getElementById('addCurrentPageBtn'); 
    const groupsContainer = document.getElementById('groupsContainer');
    
    // --- 全局变量 ---
    let groups = [];
    let scenes = [];
    let currentSceneName = '';
    let currentMode = 'hybrid';

    // --- 主函数：程序入口 ---
    const initialize = async () => {
        const data = await chrome.storage.local.get([
            'groups',
            'scenes',
            'current_scene_name',
            'current_mode',
            'focus_scores_history'
        ]);
        
        groups = data.groups || [];
        scenes = data.scenes || [];
        currentMode = data.current_mode || 'hybrid';
        currentSceneName = data.current_scene_name || '';

        updateFocusScoreUI(data.focus_scores_history || []);
        updateModeUI(currentMode);
        renderGroups();
        populateGroupSelect();
        renderScenes();

        // --- 绑定事件监听器 ---
        modeHardcoreBtn.addEventListener('click', () => switchMode('hardcore'));
        modeHybridBtn.addEventListener('click', () => switchMode('hybrid'));
        modeAiBtn.addEventListener('click', () => switchMode('ai'));
        
        // 场景管理事件
        sceneSelect.addEventListener('change', handleSceneSelectChange);
        addSceneBtn.addEventListener('click', () => openSceneEditor()); // 新增
        editSceneBtn.addEventListener('click', () => { // 修改
            const sceneToEdit = scenes.find(s => s.name === currentSceneName);
            if(sceneToEdit) openSceneEditor(sceneToEdit);
        });
        deleteSceneBtn.addEventListener('click', handleDeleteScene);
        exportSceneBtn.addEventListener('click', handleExportScene);
        importSceneBtn.addEventListener('click', handleImportScene);

        // 模态框事件
        addTaskBtn.addEventListener('click', () => createTaskInput());
        saveSceneBtn.addEventListener('click', handleSaveScene);
        cancelSceneBtn.addEventListener('click', closeSceneEditor);
        sceneEditorModal.addEventListener('click', (e) => { // 点击遮罩层关闭
            if (e.target === sceneEditorModal) closeSceneEditor();
        });
        tasksContainer.addEventListener('click', (e) => { // 任务删除按钮事件代理
            if (e.target.classList.contains('remove-task-btn') || e.target.parentElement.classList.contains('remove-task-btn')) {
                e.target.closest('.task-input-group').remove();
            }
        });

        // 规则锁定事件
        addBtn.addEventListener('click', handleAdd);
        addCurrentPageBtn.addEventListener('click', handleAddCurrentPage);
        groupSelect.addEventListener('change', handleGroupSelectChange);
        groupsContainer.addEventListener('click', handleReclassifyClick);
    };

    // --- 场景编辑器核心函数 ---
    const openSceneEditor = (scene = null) => {
        if (scene) { // 编辑模式
            modalTitle.textContent = '修改场景';
            sceneNameInput.value = scene.name;
            editingSceneName = scene.name;
            tasksContainer.innerHTML = ''; // 清空旧任务
            scene.tasks.forEach(task => createTaskInput(task));
        } else { // 新增模式
            modalTitle.textContent = '新增场景';
            sceneNameInput.value = '';
            editingSceneName = null;
            tasksContainer.innerHTML = '';
            createTaskInput(); // 默认创建一个空任务输入框
        }
        sceneEditorModal.style.display = 'flex';
    };

    const closeSceneEditor = () => {
        sceneEditorModal.style.display = 'none';
    };

    const createTaskInput = (value = '') => {
        const div = document.createElement('div');
        div.className = 'task-input-group';
        div.innerHTML = `
            <input type="text" class="task-input" placeholder="例如：学习AI" value="${value}">
            <button class="remove-task-btn" title="删除任务"><i class="fas fa-times-circle"></i></button>
        `;
        tasksContainer.appendChild(div);
    };

    const handleSaveScene = () => {
        const newName = sceneNameInput.value.trim();
        if (!newName) {
            alert('场景名称不能为空！');
            return;
        }

        // 检查除自身外是否重名
        if (scenes.some(s => s.name.toLowerCase() === newName.toLowerCase() && s.name !== editingSceneName)) {
            alert('该场景名称已存在！');
            return;
        }

        const taskInputs = tasksContainer.querySelectorAll('.task-input');
        const tasks = Array.from(taskInputs).map(input => input.value.trim()).filter(Boolean);

        if (tasks.length === 0) {
            alert('至少需要一个具体任务！');
            return;
        }

        if (editingSceneName) { // 更新现有场景
            const sceneToUpdate = scenes.find(s => s.name === editingSceneName);
            if (sceneToUpdate) {
                sceneToUpdate.name = newName;
                sceneToUpdate.tasks = tasks;
            }
        } else { // 添加新场景
            scenes.push({ name: newName, tasks });
        }

        currentSceneName = newName;
        saveScenesAndRender();
        closeSceneEditor();
    };


    // --- UI渲染与数据存储函数 ---
    const updateFocusScoreUI = (scoresHistory) => {
        if (currentMode === 'hardcore') {
            focusScoreEl.textContent = '--';
            return;
        }
        if (scoresHistory.length > 0) {
            const sum = scoresHistory.reduce((total, score) => total + score, 0);
            const average = Math.round(sum / scoresHistory.length);
            focusScoreEl.textContent = average;
        } else {
            focusScoreEl.textContent = '--';
        }
    };
    
    const updateModeUI = (mode) => {
        modeHardcoreBtn.classList.toggle('active', mode === 'hardcore');
        modeHybridBtn.classList.toggle('active', mode === 'hybrid');
        modeAiBtn.classList.toggle('active', mode === 'ai');
        
        const isAiDisabled = (mode === 'hardcore');
        sceneControlArea.style.opacity = isAiDisabled ? '0.5' : '1';
        sceneSelect.disabled = isAiDisabled;
        [addSceneBtn, editSceneBtn, deleteSceneBtn, exportSceneBtn, importSceneBtn].forEach(btn => btn.disabled = isAiDisabled);
        
        if (isAiDisabled) {
            focusScoreEl.textContent = '--';
        } else {
            chrome.storage.local.get('focus_scores_history').then(data => {
                updateFocusScoreUI(data.focus_scores_history || []);
            });
        }
    };
    
    const renderScenes = () => {
        sceneSelect.innerHTML = '';
        const hasScenes = scenes.length > 0;

        if (!hasScenes) {
            sceneSelect.innerHTML = '<option value="">无可用场景, 请新增</option>';
        } else {
            scenes.forEach(scene => {
                const option = new Option(scene.name, scene.name);
                if (scene.name === currentSceneName) {
                    option.selected = true;
                }
                sceneSelect.appendChild(option);
            });
        }

        editSceneBtn.disabled = !hasScenes || currentMode === 'hardcore';
        deleteSceneBtn.disabled = !hasScenes || currentMode === 'hardcore';
        exportSceneBtn.disabled = !hasScenes || currentMode === 'hardcore';
        updateAiIntentFromScene();
    };

    const saveScenesAndRender = async () => {
        await chrome.storage.local.set({ scenes, current_scene_name: currentSceneName });
        renderScenes();
    };
    
    const updateAiIntentFromScene = () => {
        const currentScene = scenes.find(s => s.name === currentSceneName);
        const newIntent = currentScene ? currentScene.tasks.join(', ') : '';
        chrome.storage.local.set({ ai_intent: newIntent });
    };

    const handleSceneSelectChange = () => {
        currentSceneName = sceneSelect.value;
        chrome.storage.local.set({ current_scene_name: currentSceneName });
        updateAiIntentFromScene();
    };

    const handleDeleteScene = () => {
        if (!currentSceneName) {
            alert("没有可删除的场景！");
            return;
        }
        if (confirm(`确定要删除场景 "${currentSceneName}" 吗？`)) {
            scenes = scenes.filter(s => s.name !== currentSceneName);
            currentSceneName = scenes.length > 0 ? scenes[0].name : '';
            saveScenesAndRender();
        }
    };
    
    const handleExportScene = () => {
        const sceneToExport = scenes.find(s => s.name === currentSceneName);
        if (!sceneToExport) {
            alert("请选择一个要导出的场景！");
            return;
        }
        const tasksString = sceneToExport.tasks.map(t => `“${t}”`).join('');
        const exportText = `“${sceneToExport.name}”-${tasksString}-pathBlock`;
        
        navigator.clipboard.writeText(exportText).then(() => {
            alert(`场景已复制到剪贴板！\n\n${exportText}`);
        }).catch(err => {
            alert('复制失败，请手动复制:\n\n' + exportText);
        });
    };
    
    const handleImportScene = () => {
        const importText = prompt("请粘贴要导入的场景文字:");
        if (!importText || !importText.trim().endsWith('-pathBlock')) {
            alert("导入格式不正确！请确认文字以 '-pathBlock' 结尾。");
            return;
        }
        try {
            const cleanText = importText.replace(/-pathBlock$/, '');
            const parts = cleanText.split('-');
            const sceneName = parts[0].replace(/“|”/g, '').trim();
            const tasks = parts[1].match(/“[^”]+”/g).map(t => t.replace(/“|”/g, '').trim());

            if (!sceneName || tasks.length === 0) throw new Error("解析失败");

            if (scenes.some(s => s.name.toLowerCase() === sceneName.toLowerCase())) {
                if (!confirm(`场景 "${sceneName}" 已存在，是否覆盖？`)) return;
                scenes = scenes.filter(s => s.name.toLowerCase() !== sceneName.toLowerCase());
            }
            scenes.push({ name: sceneName, tasks });
            currentSceneName = sceneName;
            saveScenesAndRender();
            alert(`场景 "${sceneName}" 导入成功！`);
        } catch(e) {
            alert("导入失败！文本格式似乎有误。");
        }
    };
    
    // --- 模式切换 ---
    const switchMode = (newMode) => {
        currentMode = newMode;
        chrome.storage.local.set({ current_mode: newMode });
        updateModeUI(newMode);
    };

    // --- 规则锁定部分 (无修改) ---
    const renderGroups = () => {
        groupsContainer.innerHTML = '';
        if (groups.length === 0) {
            groupsContainer.innerHTML = '<div class="empty-list">无锁定规则</div>';
            return;
        }
        groups.sort((a, b) => a.groupName.localeCompare(b.groupName));
        groups.forEach(group => {
            const groupContainer = document.createElement('div');
            groupContainer.className = 'group-container';
            const header = document.createElement('div');
            header.className = 'group-header collapsed';
            header.innerHTML = `<span class="group-name">${group.groupName}</span><i class="fas fa-chevron-down toggle-icon"></i>`;
            const sitesList = document.createElement('ul');
            sitesList.className = 'sites-list';
            group.sites.sort((a, b) => a.name.localeCompare(b.name));
            group.sites.forEach(site => {
                const li = document.createElement('li');
                li.className = 'locked-item';
                const reclassifyButtonHTML = group.groupName === '未分类' ?
                    `<button class="reclassify-btn" data-path="${site.path}" title="重新分类"><i class="fas fa-folder-plus"></i></button>` : '';
                li.innerHTML = `<div class="site-info"><span class="site-name" title="${site.name}">${site.name}</span><span class="site-domain" title="${site.path}">${site.path}</span></div><div class="item-actions"><i class="fas fa-lock lock-icon" title="此规则已永久锁定"></i>${reclassifyButtonHTML}</div>`;
                sitesList.appendChild(li);
            });
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
                sitesList.classList.toggle('expanded');
            });
            groupContainer.appendChild(header);
            groupContainer.appendChild(sitesList);
            groupsContainer.appendChild(groupContainer);
        });
    };

    const populateGroupSelect = () => {
        const currentSelection = groupSelect.value;
        groupSelect.innerHTML = `<option value="__nogroup__">暂不分组</option><option value="__newgroup__" style="font-weight: bold; color: #007aff;">[ 新建分组... ]</option>`;
        groups.forEach(group => {
            if (group.groupName !== '未分类') {
                const option = new Option(group.groupName, group.groupName);
                groupSelect.appendChild(option);
            }
        });
        if (groupSelect.querySelector(`option[value="${currentSelection}"]`)) {
            groupSelect.value = currentSelection;
        }
    };

    const handleAdd = async () => {
        const customName = nameInput.value.trim();
        let path = pathInput.value.trim();
        const selectedGroup = groupSelect.value;
        if (!customName || !path) { alert('规则名称和URL路径都不能为空！'); return; }
        if (!isValidPath(path)) { alert('URL路径格式无效！请输入类似 "example.com/path" 的格式。'); return; }
        path = cleanPath(path);
        const groupName = selectedGroup === '__nogroup__' || selectedGroup === '__newgroup__' ? '未分类' : selectedGroup;
        if (groups.some(g => g.sites.some(s => s.path === path))) { alert("这个精确路径已在锁定列表中！"); return; }
        if (window.confirm(`确定要永久锁定规则 "${customName}" 吗？\n\n一旦确认将无法撤销。`)) {
            const newRule = { name: customName, path: path };
            let group = groups.find(g => g.groupName === groupName);
            if (group) group.sites.push(newRule);
            else groups.push({ groupName: groupName, sites: [newRule] });
            await saveAndApply();
            nameInput.value = ''; pathInput.value = ''; groupSelect.value = '__nogroup__';
            renderGroups(); populateGroupSelect();
        }
    };

    const handleGroupSelectChange = () => {
        if (groupSelect.value === '__newgroup__') {
            const newGroupName = prompt('请输入新分组的名称：');
            if (newGroupName && newGroupName.trim()) {
                const trimmedName = newGroupName.trim();
                if (!groups.some(g => g.groupName.toLowerCase() === trimmedName.toLowerCase())) {
                    const option = new Option(trimmedName, trimmedName);
                    groupSelect.appendChild(option);
                    option.selected = true;
                } else {
                    alert('该分组已存在！'); groupSelect.value = trimmedName;
                }
            } else { groupSelect.value = '__nogroup__'; }
        }
    };
    
    const handleAddCurrentPage = async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && !tab.url.startsWith('chrome://')) {
                nameInput.value = tab.title || '当前页面';
                pathInput.value = cleanPath(tab.url);
                nameInput.focus();
            } else { alert('无法获取当前页面的信息。'); }
        } catch (error) { alert('获取当前页面信息失败。'); }
    };

    const handleReclassifyClick = async (event) => {
        const target = event.target.closest('.reclassify-btn');
        if (!target) return;
        const path_to_move = target.dataset.path;
        const newGroupName = prompt('请输入新的分组名称：');
        if (!newGroupName || !newGroupName.trim() || newGroupName.trim() === '未分类') return;
        const trimmedGroupName = newGroupName.trim();
        const unclassifiedGroup = groups.find(g => g.groupName === '未分类');
        if (!unclassifiedGroup) return;
        const siteIndex = unclassifiedGroup.sites.findIndex(s => s.path === path_to_move);
        if (siteIndex === -1) return;
        const [siteToMove] = unclassifiedGroup.sites.splice(siteIndex, 1);
        if (unclassifiedGroup.sites.length === 0) groups = groups.filter(g => g.groupName !== '未分类');
        let targetGroup = groups.find(g => g.groupName === trimmedGroupName);
        if (targetGroup) targetGroup.sites.push(siteToMove);
        else groups.push({ groupName: trimmedGroupName, sites: [siteToMove] });
        await saveAndApply(); renderGroups(); populateGroupSelect();
    };

    // --- 辅助函数 ---
    const isValidPath = (path) => path.includes('.') && !/\s/.test(path);
    const cleanPath = (path) => path.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    const saveAndApply = async () => await chrome.storage.local.set({ groups: groups });

    // --- 启动程序 ---
    initialize();
});