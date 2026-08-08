import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, get, remove, child } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyA256vpgg8E-oQkoTGqgix4ev6nshlKGmE",
    authDomain: "jwtsp-160b0.firebaseapp.com",
    databaseURL: "https://jwtsp-160b0-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "jwtsp-160b0",
    storageBucket: "jwtsp-160b0.appspot.com",
    messagingSenderId: "874514334362",
    appId: "1:874514334362:web:63e037047a3711f6115523",
    measurementId: "G-H2TG0W9JJJ"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// UI Elements
const excelBody = document.getElementById('excel-body');
const csvInput = document.getElementById('csv-input');
const jsonInput = document.getElementById('json-input');
const saveBtn = document.getElementById('btn-save');
const deleteBtn = document.getElementById('btn-delete-lesson');
const spinner = document.getElementById('loading-spinner');
const lessonSelect = document.getElementById('lesson-select');
const lessonTitleInput = document.getElementById('lesson-title');
const lessonIdHidden = document.getElementById('lesson-id-hidden');
const dataTypeSelect = document.getElementById('data-type');
const levelSelect = document.getElementById('level');

// Toast Notification System
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';

    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}
const adminCache = {
    lessons: {}, // { "vocab_N5": data }
    words: {}    // { "vocab_N5_L1": data }
};

// Biến lưu trạng thái thay đổi (Dirty state) và thông tin bài hiện tại
let isFormDirty = false;
let previousSelectValue = 'new';
let currentEditingContext = {
    type: 'vocab',
    level: 'N5'
};

// Tải danh sách bài học hiện có
async function loadExistingLessons() {
    const type = dataTypeSelect.value;
    const level = levelSelect.value;
    currentEditingContext = { type, level }; // Lưu lại ngữ cảnh Level/Type hiện tại
    const cacheKey = `${type}_${level}`;
    
    // Reset select
    lessonSelect.innerHTML = '<option value="new">-- Tạo bài mới --</option>';

    // Check Cache
    if (adminCache.lessons[cacheKey]) {
        console.log(`⚡ [Admin Cache Hit] Danh sách bài học: ${cacheKey}`);
        populateLessonSelect(adminCache.lessons[cacheKey]);
        return;
    }

    showSpinner(true);
    console.log(`🔥 [Firebase Request] GET -> tuannv_new/metadata/${type}/${level}/lessons`);
    try {
        const snapshot = await get(ref(db, `tuannv_new/metadata/${type}/${level}/lessons`));
        if (snapshot.exists()) {
            const lessons = snapshot.val();
            adminCache.lessons[cacheKey] = lessons; // Save Cache
            populateLessonSelect(lessons);
        }
    } catch (e) {
        console.error("Lỗi tải danh sách bài học:", e);
    } finally {
        showSpinner(false);
    }
}

function populateLessonSelect(lessons) {
    Object.keys(lessons).forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = lessons[id].title || id;
        lessonSelect.appendChild(opt);
    });
}

// Đánh dấu form có sự thay đổi
function markFormDirty() {
    isFormDirty = true;
    saveBtn.disabled = false;
    saveBtn.style.opacity = '1';
    saveBtn.style.cursor = 'pointer';
}

// Reset trạng thái thay đổi
function resetFormDirty() {
    isFormDirty = false;
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.5';
    saveBtn.style.cursor = 'not-allowed';
}

// Hàm kiểm tra trạng thái form để disable/enable nút Lưu và Clear
function checkFormState() {
    const isNew = lessonSelect.value === 'new';
    const title = lessonTitleInput.value.trim();

    // Lấy dữ liệu từ Excel/CSV/JSON
    let hasContent = false;
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'excel-mode';

    if (activeTab === 'excel-mode') {
        const rows = excelBody.querySelectorAll('tr');
        rows.forEach(row => {
            const inputs = row.querySelectorAll('input');
            inputs.forEach(input => {
                if (input.value.trim() !== '') hasContent = true;
            });
        });
    } else if (activeTab === 'csv-mode') {
        if (csvInput.value.trim() !== '') hasContent = true;
    } else if (activeTab === 'json-mode') {
        if (jsonInput.value.trim() !== '') hasContent = true;
    }

    if (isNew) {
        // Disable nút CLEAR nếu form hoàn toàn trống
        if (!title && !hasContent) {
            deleteBtn.disabled = true;
            deleteBtn.style.opacity = '0.5';
            deleteBtn.style.cursor = 'not-allowed';
        } else {
            deleteBtn.disabled = false;
            deleteBtn.style.opacity = '1';
            deleteBtn.style.cursor = 'pointer';
        }

        // Disable nút LƯU nếu chưa nhập tiêu đề HOẶC chưa nhập dữ liệu
        if (!title || !hasContent) {
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.5';
            saveBtn.style.cursor = 'not-allowed';
        } else {
            saveBtn.disabled = false;
            saveBtn.style.opacity = '1';
            saveBtn.style.cursor = 'pointer';
        }
    } else {
        // Nếu chọn bài cũ: Nút Clear/Xóa luôn mở
        deleteBtn.disabled = false;
        deleteBtn.style.opacity = '1';
        deleteBtn.style.cursor = 'pointer';

        // Nút LƯU chỉ bật khi isFormDirty = true
        if (isFormDirty) {
            saveBtn.disabled = false;
            saveBtn.style.opacity = '1';
            saveBtn.style.cursor = 'pointer';
        } else {
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.5';
            saveBtn.style.cursor = 'not-allowed';
        }
    }
}

// Hàm reset form về trạng thái tạo mới trống
function resetFormToNew() {
    lessonSelect.value = 'new';
    previousSelectValue = 'new';
    lessonTitleInput.value = '';
    lessonIdHidden.value = '';
    excelBody.innerHTML = '';
    for(let i=0; i<5; i++) excelBody.appendChild(createRow());
    csvInput.value = '';
    jsonInput.value = '';
    resetFormDirty();
    updateDeleteBtnUI();
    checkFormState();
}

// Modal elements
const unsavedModal = document.getElementById('unsaved-modal');
const btnModalDiscard = document.getElementById('btn-modal-discard');
const btnModalSave = document.getElementById('btn-modal-save');

function showUnsavedModal() {
    return new Promise((resolve) => {
        unsavedModal.classList.remove('hidden');

        btnModalSave.onclick = () => {
            unsavedModal.classList.add('hidden');
            resolve('save');
        };

        btnModalDiscard.onclick = () => {
            unsavedModal.classList.add('hidden');
            resolve('discard');
        };
    });
}

// Khi chọn 1 bài học từ danh sách
lessonSelect.onchange = async (e) => {
    const nextVal = lessonSelect.value;

    // Kiểm tra nếu form đang bị sửa đổi (Dirty)
    if (isFormDirty) {
        const choice = await showUnsavedModal();
        
        if (choice === 'save') {
            // Chọn LƯU THAY ĐỔI -> Tự động lưu trước
            const savedSuccess = await handleSaveAction();
            if (!savedSuccess) {
                // Nếu lưu bị lỗi/trùng tên -> Trả lại select cũ
                lessonSelect.value = previousSelectValue;
                return;
            }
        }
    }

    // Tiến hành đổi bài
    previousSelectValue = nextVal;
    resetFormDirty();
    updateDeleteBtnUI();

    if (nextVal === 'new') {
        resetFormToNew();
        return;
    }

    const type = dataTypeSelect.value;
    const level = levelSelect.value;
    const cacheKey = `${type}_${level}_${nextVal}`;

    // Check Cache
    if (adminCache.words[cacheKey]) {
        console.log(`⚡ [Admin Cache Hit] Từ vựng bài học: ${cacheKey}`);
        populateFormWithData(nextVal, adminCache.words[cacheKey]);
        resetFormDirty();
        checkFormState();
        return;
    }

    // Load dữ liệu bài cũ
    showSpinner(true);
    console.log(`🔥 [Firebase Request] GET -> tuannv_new/content/${type}/${level}/${nextVal}`);
    try {
        const snapshot = await get(ref(db, `tuannv_new/content/${type}/${level}/${nextVal}`));
        if (snapshot.exists()) {
            const data = snapshot.val();
            adminCache.words[cacheKey] = data; // Save Cache
            populateFormWithData(nextVal, data);
        }
    } catch (err) {
        console.error(err);
    } finally {
        showSpinner(false);
        resetFormDirty();
        checkFormState();
    }
};

function populateFormWithData(lessonId, data) {
    lessonIdHidden.value = lessonId;
    lessonTitleInput.value = lessonSelect.options[lessonSelect.selectedIndex].text;

    // 1. Populate Excel
    excelBody.innerHTML = '';
    Object.values(data).forEach(w => {
        excelBody.appendChild(createRow(w.kanji, w.hira, w.mean, w.cnvi));
    });
    excelBody.appendChild(createRow());
    excelBody.appendChild(createRow());

    // 2. Populate CSV
    csvInput.value = Object.values(data)
        .map(w => `${w.kanji} | ${w.hira} | ${w.cnvi || ''} | ${w.mean}`)
        .join('\n');

    // 3. Populate JSON
    jsonInput.value = JSON.stringify(Object.values(data).map(w => ({
        kanji: w.kanji || '',
        hira: w.hira || '',
        cnvi: w.cnvi || '',
        mean: w.mean || ''
    })), null, 2);
}

// Đăng ký các listener lắng nghe thay đổi để kiểm tra form và đánh dấu Dirty
lessonTitleInput.addEventListener('input', () => {
    markFormDirty();
    checkFormState();
});
csvInput.addEventListener('input', () => {
    markFormDirty();
    checkFormState();
});
jsonInput.addEventListener('input', () => {
    markFormDirty();
    checkFormState();
});

// Cập nhật tên nút Xóa / Clear
function updateDeleteBtnUI() {
    const isNew = lessonSelect.value === 'new';
    if (isNew) {
        deleteBtn.innerHTML = '<i class="fas fa-broom"></i> CLEAR';
    } else {
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> XÓA BÀI HỌC';
    }
}

// Xử lý chuyển đổi Level hoặc DataType có kiểm tra Dirty
async function handleFilterChange() {
    if (isFormDirty) {
        const choice = await showUnsavedModal();
        if (choice === 'save') {
            // Sử dụng ngữ cảnh cũ trước khi Level bị đổi
            const savedSuccess = await handleSaveAction(currentEditingContext.type, currentEditingContext.level);
            if (!savedSuccess) {
                // Trả lại Select Level/Type cũ nếu lưu bị lỗi
                dataTypeSelect.value = currentEditingContext.type;
                levelSelect.value = currentEditingContext.level;
                return;
            }
        }
    }
    
    resetFormToNew();
    await loadExistingLessons();
}

dataTypeSelect.onchange = handleFilterChange;
levelSelect.onchange = handleFilterChange;

// Khởi tạo lần đầu
loadExistingLessons();
updateDeleteBtnUI();


// Tabs logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.remove('hidden');
        checkFormState();
    });
});

// Excel Table logic
function checkAndAutoAddRows(e) {
    const currentInput = e.target;
    const currentTr = currentInput.closest('tr');
    const rows = Array.from(excelBody.querySelectorAll('tr'));
    const totalRows = rows.length;
    const currentIndex = rows.indexOf(currentTr); // Vị trí dòng hiện tại (0 -> totalRows-1)

    // Kiểm tra dòng gần cuối (thứ n-1, tức index = totalRows - 2)
    if (currentIndex === totalRows - 2) {
        excelBody.appendChild(createRow());
    } 
    // Kiểm tra dòng cuối cùng (thứ n, tức index = totalRows - 1)
    else if (currentIndex === totalRows - 1) {
        excelBody.appendChild(createRow());
        excelBody.appendChild(createRow());
    }
}

function createRow(kanji = '', hira = '', mean = '', cnvi = '') {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" class="cell-kanji" value="${kanji}" placeholder="..."></td>
        <td><input type="text" class="cell-hira" value="${hira}" placeholder="..."></td>
        <td><input type="text" class="cell-cnvi" value="${cnvi}" placeholder="..."></td>
        <td><input type="text" class="cell-mean" value="${mean}" placeholder="..."></td>
        <td><button class="btn-delete-row"><i class="fas fa-trash"></i></button></td>
    `;
    
    // Đăng ký sự kiện input cho tất cả các ô trong dòng
    tr.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', (e) => {
            checkAndAutoAddRows(e);
            markFormDirty();
            checkFormState();
        });
    });

    tr.querySelector('.btn-delete-row').onclick = () => {
        tr.remove();
        markFormDirty();
        checkFormState();
    };
    return tr;
}

// Initialize table with some empty rows
for(let i=0; i<5; i++) excelBody.appendChild(createRow());

// Hàm xử lý lưu
async function handleSaveAction(overrideType = null, overrideLevel = null) {
    const type = overrideType || dataTypeSelect.value;
    const level = overrideLevel || levelSelect.value;
    const lessonTitle = lessonTitleInput.value.trim();
    let lessonId = lessonIdHidden.value;

    if (!lessonTitle) {
        showToast("Vui lòng nhập Tiêu đề bài học!", 'error');
        return false;
    }

    // 3.3: Kiểm tra trùng tên bài học trong cùng Type & Level
    const existingOptions = Array.from(lessonSelect.options);
    const isDuplicate = existingOptions.some(opt => {
        if (!lessonId && opt.value !== 'new') {
            return opt.text.trim().toLowerCase() === lessonTitle.toLowerCase();
        }
        if (lessonId && opt.value !== lessonId && opt.value !== 'new') {
            return opt.text.trim().toLowerCase() === lessonTitle.toLowerCase();
        }
        return false;
    });

    if (isDuplicate) {
        showToast(`❌ Tên bài học "${lessonTitle}" đã tồn tại!`, 'error');
        return false;
    }

    // Nếu là bài mới, tự tạo ID
    if (!lessonId) {
        const now = new Date();
        lessonId = 'L' + now.getTime();
    }

    let dataToSave = {};
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'excel-mode';

    if (activeTab === 'excel-mode') {
        const rows = excelBody.querySelectorAll('tr');
        rows.forEach((row, index) => {
            const kanji = row.querySelector('.cell-kanji').value.trim();
            const hira = row.querySelector('.cell-hira').value.trim();
            const cnvi = row.querySelector('.cell-cnvi').value.trim();
            const mean = row.querySelector('.cell-mean').value.trim();
            if (kanji || hira || mean || cnvi) {
                dataToSave[`w${index.toString().padStart(3, '0')}`] = { kanji, hira, cnvi, mean };
            }
        });
    } else if (activeTab === 'csv-mode') {
        const lines = csvInput.value.split('\n');
        lines.forEach((line, index) => {
            const parts = line.split('|').map(s => s.trim());
            if (parts.length >= 2) {
                dataToSave[`w${index.toString().padStart(3, '0')}`] = {
                    kanji: parts[0] || '',
                    hira: parts[1] || '',
                    cnvi: parts[2] || '',
                    mean: parts[3] || ''
                };
            }
        });
    } else if (activeTab === 'json-mode') {
        try {
            const parsedArray = JSON.parse(jsonInput.value.trim());
            if (Array.isArray(parsedArray)) {
                parsedArray.forEach((item, index) => {
                    dataToSave[`w${index.toString().padStart(3, '0')}`] = {
                        kanji: item.kanji || '',
                        hira: item.hira || '',
                        cnvi: item.cnvi || '',
                        mean: item.mean || ''
                    };
                });
            } else {
                showToast("Dữ liệu JSON phải là một MẢNG chứa các đối tượng []", 'error');
                return false;
            }
        } catch (err) {
            showToast("Lỗi cú pháp JSON! Vui lòng kiểm tra lại.", 'error');
            return false;
        }
    }

    if (Object.keys(dataToSave).length === 0) {
        showToast("Không có dữ liệu để lưu!", 'error');
        return false;
    }

    showSpinner(true);
    console.log(`🔥 [Firebase Request] SET -> tuannv_new/content/${type}/${level}/${lessonId}`);
    console.log(`🔥 [Firebase Request] SET -> tuannv_new/metadata/${type}/${level}/lessons/${lessonId}`);
    try {
        await set(ref(db, `tuannv_new/content/${type}/${level}/${lessonId}`), dataToSave);
        await set(ref(db, `tuannv_new/metadata/${type}/${level}/lessons/${lessonId}`), {
            title: lessonTitle,
            count: Object.keys(dataToSave).length
        });

        showToast("Đã lưu thành công!", 'success');
        delete adminCache.lessons[`${type}_${level}`];
        delete adminCache.words[`${type}_${level}_${lessonId}`];
        
        // Reset form về bài mới và reload danh sách bài học
        resetFormToNew();
        await loadExistingLessons();
        return true;
    } catch (e) {
        console.error(e);
        showToast("Lỗi khi lưu: " + e.message, 'error');
        return false;
    } finally {
        showSpinner(false);
    }
}

// Logic SAVE
saveBtn.addEventListener('click', async () => {
    await handleSaveAction();
});

// Logic DELETE / CLEAR
deleteBtn.onclick = async () => {
    const isNew = lessonSelect.value === 'new';
    
    // 2.1: Nếu đang ở option "Tạo bài mới" -> CLEAR
    if (isNew) {
        if (confirm("Bạn có chắc chắn muốn XÓA TOÀN BỘ dữ liệu đang nhập không?")) {
            lessonTitleInput.value = '';
            excelBody.innerHTML = '';
            for(let i=0; i<5; i++) excelBody.appendChild(createRow());
            csvInput.value = '';
            jsonInput.value = '';
            checkFormState();
        }
        return;
    }

    // 2.2: Nếu đang chọn 1 bài học -> XÓA BÀI HỌC TRÊN FIREBASE
    const type = dataTypeSelect.value;
    const level = levelSelect.value;
    const lessonId = lessonIdHidden.value || lessonSelect.value;
    const lessonTitle = lessonSelect.options[lessonSelect.selectedIndex].text;

    if (confirm(`Bạn có chắc chắn muốn XÓA vĩnh viễn bài học "${lessonTitle}" trên Firebase không?`)) {
        showSpinner(true);
        console.log(`🔥 [Firebase Request] REMOVE -> tuannv_new/content/${type}/${level}/${lessonId}`);
        console.log(`🔥 [Firebase Request] REMOVE -> tuannv_new/metadata/${type}/${level}/lessons/${lessonId}`);
        try {
            await remove(ref(db, `tuannv_new/content/${type}/${level}/${lessonId}`));
            await remove(ref(db, `tuannv_new/metadata/${type}/${level}/lessons/${lessonId}`));

            delete adminCache.lessons[`${type}_${level}`];
            delete adminCache.words[`${type}_${level}_${lessonId}`];

            showToast("Đã xóa bài học thành công!", 'success');
            
            lessonSelect.value = 'new';
            lessonSelect.onchange();
            loadExistingLessons();
        } catch (e) {
            console.error(e);
            showToast("Lỗi khi xóa: " + e.message, 'error');
        } finally {
            showSpinner(false);
        }
    }
};

// Nút Load không còn cần thiết vì đã tự động load khi chọn Select
if(loadBtn) loadBtn.style.display = 'none';


function showSpinner(show) {
    if (show) spinner.classList.remove('hidden');
    else spinner.classList.add('hidden');
}
