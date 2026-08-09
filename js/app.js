
// Thêm import set từ firebase-database
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, get, set, child, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// 1. Cấu hình Firebase (Lấy từ file cũ của bạn)
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

// Khởi tạo Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

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
const state = {
    currentView: 'dashboard',
    currentLevel: null,
    currentLesson: null,
    currentType: 'vocab',
    userId: "admin",
    cache: {
        lessons: {}, // Lưu danh sách bài học: { "vocab_N5": data }
        words: {}    // Lưu từ vựng chi tiết: { "vocab_N5_L1": data }
    },
    learningParams: {
        words: [],          // Mảng chứa các từ hiện tại đang học
        isHardFiltered: false, // Trạng thái lọc sao
        hiddenCols: { reading: false, meaning: false },
        mode: 'list',       // list | flashcard | quiz
        fcIndex: 0,
        quizIndex: 0,
        quizScore: 0,
        pendingSM2Updates: {} // Chứa object { lessonId: { wordId: sm2Object } }
    }
};

// 3. Các phần tử UI
const views = {
    dashboard: document.getElementById('dashboard'),
    lesson: document.getElementById('lesson-view'),
    learning: document.getElementById('learning-view')
};

const spinner = document.getElementById('loading-spinner');
const menuToggle = document.getElementById('menu-toggle');
const mainMenu = document.getElementById('main-menu');

// Menu Toggle Logic
if (menuToggle) {
    menuToggle.onclick = (e) => {
        e.stopPropagation();
        mainMenu.classList.toggle('hidden');
    };
}

document.onclick = () => {
    if (mainMenu) mainMenu.classList.add('hidden');
};


// 4. Các hàm điều hướng
function switchView(viewName) {
    Object.keys(views).forEach(key => {
        views[key].classList.add('hidden');
    });
    views[viewName].classList.remove('hidden');
    state.currentView = viewName;
    window.scrollTo(0, 0);
}

// 5. Logic xử lý dữ liệu

// SM-2 Algorithm Calculation
function calculateSM2(quality, prevSm2) {
    let { interval, repetition, efactor } = prevSm2;

    if (quality >= 3) {
        if (repetition === 0) {
            interval = 1;
        } else if (repetition === 1) {
            interval = 6;
        } else {
            interval = Math.round(interval * efactor);
        }
        repetition++;
    } else {
        repetition = 0;
        interval = 1;
    }

    efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (efactor < 1.3) efactor = 1.3;

    // Tính ngày học tiếp theo (cộng số ngày bằng milliseconds)
    const nextReviewDate = new Date().getTime() + (interval * 24 * 60 * 60 * 1000);

    return { interval, repetition, efactor, nextReviewDate };
}

async function fetchSpacedReviewWords(level) {
    const type = state.currentType;
    showSpinner(true);

    try {
        const dbRef = ref(db);
        const lessonsSnapshot = await get(child(dbRef, `tuannv_new/metadata/${type}/${level}/lessons`));
        if (!lessonsSnapshot.exists()) {
            showToast("Chưa có dữ liệu bài học nào để ôn tập.", "info");
            showSpinner(false);
            return;
        }

        const lessons = lessonsSnapshot.val();
        let learnedLessonIds = Object.keys(lessons).filter(id => lessons[id].lastLearned);

        if (learnedLessonIds.length === 0) {
            showToast("Bạn chưa học bài nào, hãy hoàn thành ít nhất 1 bài trước nhé!", "info");
            showSpinner(false);
            return;
        }

        // Tải toàn bộ từ vựng
        let allLearnedWords = [];
        for (const lessonId of learnedLessonIds) {
            const wordSnap = await get(child(dbRef, `tuannv_new/content/${type}/${level}/${lessonId}`));
            if (wordSnap.exists()) {
                const wordsObj = wordSnap.val();
                const processed = processRawWordsToArray(wordsObj, false);
                processed.forEach(w => w.lessonId = lessonId); // Cần thiết để save lại đúng chỗ
                allLearnedWords = allLearnedWords.concat(processed);
            }
        }

        const now = new Date().getTime();

        // 1. Lọc ra những từ đến hạn ôn tập (nextReviewDate <= now)
        let dueWords = allLearnedWords.filter(w => w.sm2.nextReviewDate <= now);

        // Nếu không có từ nào đến hạn, lấy 10 từ học cách đây lâu nhất để ôn tập sương sương
        if (dueWords.length === 0) {
            showToast("Chưa có từ nào đến hạn ôn tập! Lấy ngẫu nhiên vài từ cũ nhé.", "info");
            dueWords = allLearnedWords.sort((a, b) => a.sm2.nextReviewDate - b.sm2.nextReviewDate).slice(0, 10);
        }

        // Ưu tiên từ khó (isHard) và từ có nextReviewDate cũ nhất
        dueWords.sort((a, b) => {
            if (a.isHard && !b.isHard) return -1;
            if (!a.isHard && b.isHard) return 1;
            return a.sm2.nextReviewDate - b.sm2.nextReviewDate;
        });

        // Lấy tối đa 25 từ
        const reviewWords = dueWords.slice(0, 25);

        state.currentLesson = "review";
        document.getElementById('current-lesson-title').innerText = "Ôn tập SM-2";

        state.learningParams.words = reviewWords;
        state.learningParams.isHardFiltered = false;
        document.getElementById('btn-filter-hard').classList.add('hidden'); // Ẩn lọc sao
        document.getElementById('mode-select').value = 'flashcard';
        document.getElementById('mode-select').disabled = true; // Chỉ cho phép flashcard

        state.learningParams.mode = 'flashcard';
        state.learningParams.hiddenCols = { reading: false, meaning: false };
        state.learningParams.pendingSM2Updates = {}; // Reset pending updates

        document.getElementById('global-save-container').style.display = 'none';

        updateLearningView();
        switchView('learning');

    } catch (error) {
        console.error(error);
        showToast("Lỗi khi tải dữ liệu ôn tập!", "error");
    } finally {
        showSpinner(false);
    }
}

async function fetchLessons(level) {

    const type = state.currentType;
    const cacheKey = `${type}_${level}`;

    // Kiểm tra nếu đã có trong Cache
    if (state.cache.lessons[cacheKey]) {
        renderLessons(level, state.cache.lessons[cacheKey]);
        switchView('lesson');
        return;
    }

    showSpinner(true);
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, `tuannv_new/metadata/${type}/${level}/lessons`));

        // Xử lý sự kiện nút "Ôn tập ngắt quãng"
        const btnSpacedReview = document.getElementById('btn-spaced-review');
        if (btnSpacedReview) {
            // Clone nút để xóa các event listener cũ tránh gọi nhiều lần
            const newBtn = btnSpacedReview.cloneNode(true);
            btnSpacedReview.parentNode.replaceChild(newBtn, btnSpacedReview);

            newBtn.addEventListener('click', () => {
                fetchSpacedReviewWords(level);
            });
        }

        if (snapshot.exists()) {
            const data = snapshot.val();
            state.cache.lessons[cacheKey] = data;
            renderLessons(level, data);
            switchView('lesson');
        } else {
            showToast(`Không tìm thấy bài học ${type.toUpperCase()} cho trình độ ${level}.`, 'error');
            return false;
        }
        return true;
    } catch (error) {
        console.error(error);
        showToast("Lỗi khi tải dữ liệu!", 'error');
        return false;
    } finally {
        showSpinner(false);
    }
}

async function fetchWords(level, lessonId) {

    const type = state.currentType;
    const cacheKey = `${type}_${level}_${lessonId}`;

    // Kiểm tra xem bài này đã có ngày học chưa (từ cache lesson hoặc firebase snapshot nếu cần, nhưng ta có thể check từ state cache lesson)
    let isFirstTime = false;
    const lessonCacheKey = `${type}_${level}`;
    if (state.cache.lessons[lessonCacheKey] && state.cache.lessons[lessonCacheKey][lessonId]) {
        isFirstTime = !state.cache.lessons[lessonCacheKey][lessonId].lastLearned;
    }

    // Kiểm tra nếu đã có trong Cache
    if (state.cache.words[cacheKey]) {
        renderWords(lessonId, state.cache.words[cacheKey], isFirstTime);
        switchView('learning');
        return;
    }

    showSpinner(true);
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, `tuannv_new/content/${type}/${level}/${lessonId}`));

        if (snapshot.exists()) {
            const data = snapshot.val();
            state.cache.words[cacheKey] = data; // Lưu vào Cache
            renderWords(lessonId, data, isFirstTime);
            switchView('learning');
        } else {
            showToast("Bài học này chưa có dữ liệu.", 'error');
        }
    } catch (error) {
        console.error(error);
    } finally {
        showSpinner(false);
    }
}

// 6. Hàm Render giao diện
function renderLessons(level, lessons) {
    const container = document.getElementById('lesson-list');
    const title = document.getElementById('current-level-title');

    // Tên Level ở góc trái
    title.innerText = `Cấp độ ${level.toUpperCase()}`;
    container.innerHTML = '';
    state.currentLevel = level;

    Object.keys(lessons).forEach(id => {
        const lesson = lessons[id];

        let learnedHTML = '';
        if (lesson.lastLearned) {
            learnedHTML = `<small style="color:#666;">${lesson.lastLearned}</small>`;
        }

        let hardCountHTML = '';
        if (lesson.hardCount && lesson.hardCount > 0) {
            hardCountHTML = `<small style="color:#f1c40f;"><i class="fas fa-star"></i> ${lesson.hardCount}</small>`;
        }

        const div = document.createElement('div');
        div.className = 'lesson-card';
        div.innerHTML = `
            <div>
                <span>${lesson.title}</span><br>
                ${learnedHTML}
            </div>
            <div style="text-align:right">
                <small>${lesson.count || 0} từ</small><br>
                ${hardCountHTML}
            </div>
        `;
        div.onclick = () => {
            state.currentLesson = id;
            fetchWords(level, id);
        };
        container.appendChild(div);
    });
}

function processRawWordsToArray(wordsObj, isFirstTime) {
    // Convert object to array for easier shuffling/filtering
    return Object.keys(wordsObj).map(id => {
        let isHard = wordsObj[id].isHard;
        if (isFirstTime) isHard = true; // Nếu chưa học lần nào, mặc định coi tất cả là từ khó

        // Cấu trúc mặc định của SM-2
        const sm2Data = wordsObj[id].sm2 || {
            interval: 0,
            repetition: 0,
            efactor: 2.5,
            nextReviewDate: new Date().getTime() // Cho học ngay lần đầu
        };

        return {
            id: id,
            ...wordsObj[id],
            isHard: isHard,
            sm2: sm2Data
        };
    });
}

function updateLearningView() {
    const mode = state.learningParams.mode;
    document.querySelectorAll('.mode-container').forEach(el => el.classList.add('hidden'));
    document.getElementById(`${mode}-mode`).classList.remove('hidden');

    let displayWords = [...state.learningParams.words];

    if (state.learningParams.isHardFiltered) {
        displayWords = displayWords.filter(w => w.isHard);
        if (displayWords.length === 0) {
            showToast("Không có từ khó nào trong bài này!", 'info');
            document.getElementById('btn-filter-hard').classList.remove('active');
            state.learningParams.isHardFiltered = false;
            displayWords = [...state.learningParams.words];
        }
    }

    if (mode === 'list') renderListMode(displayWords);
    if (mode === 'flashcard') renderFlashcardMode(displayWords);
    if (mode === 'quiz') renderQuizMode(displayWords);

    // Xử lý giao diện SM-2 khi ở chế độ Review
    const sm2Controls = document.getElementById('fc-sm2-controls');
    const stdControls = document.getElementById('fc-standard-controls');

    if (state.currentLesson === 'review') {
        sm2Controls.classList.remove('hidden');
        stdControls.classList.add('hidden');
        document.getElementById('btn-shuffle').classList.add('hidden');
    } else {
        sm2Controls.classList.add('hidden');
        stdControls.classList.remove('hidden');
        document.getElementById('btn-shuffle').classList.remove('hidden');
        document.getElementById('btn-filter-hard').classList.remove('hidden');
        document.getElementById('mode-select').disabled = false;
    }
}

function renderWords(lessonId, rawWords, isFirstTime) {
    document.getElementById('current-lesson-title').innerText = `Chi tiết bài học`;
    document.getElementById('global-save-container').style.display = 'block'; // Hiện lại nút lưu khi học bài bth

    state.learningParams.words = processRawWordsToArray(rawWords, isFirstTime);
    state.learningParams.isHardFiltered = false;
    document.getElementById('btn-filter-hard').classList.remove('active');
    document.getElementById('mode-select').value = 'list';
    state.learningParams.mode = 'list';
    state.learningParams.hiddenCols = { reading: false, meaning: false };

    updateLearningView();
}

function renderListMode(wordsArray) {
    const tbody = document.getElementById('word-list-body');
    const title = document.getElementById('current-lesson-title');

    const th1 = document.getElementById('th-col-1');
    const th2 = document.getElementById('th-col-2');
    if (state.currentType === 'vocab') {
        if (th1) th1.innerText = 'Từ vựng';
        if (th2) th2.childNodes[0].nodeValue = 'Cách đọc ';
    } else {
        if (th1) th1.innerText = 'Hán tự';
        if (th2) th2.childNodes[0].nodeValue = 'Âm On/Kun ';
    }

    title.innerText = `Chi tiết bài học`;
    tbody.innerHTML = '';

    wordsArray.forEach((word, index) => {

        let displayWord = word.kanji ? word.kanji.trim() : '';
        let displayReading = word.hira ? word.hira.trim() : '';

        if (!displayWord) {
            displayWord = displayReading;
            displayReading = '';
        }

        const tr = document.createElement('tr');

        const tdWord = document.createElement('td');
        tdWord.className = 'word-cell';
        tdWord.innerHTML = `
            <strong style="color: var(--accent); font-size: 1.1rem;">${displayWord}</strong>
            <button class="btn-copy" title="Sao chép"><i class="far fa-copy"></i></button>
        `;

        const copyBtn = tdWord.querySelector('.btn-copy');
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(displayWord).then(() => {
                copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="far fa-copy"></i>';
                    copyBtn.classList.remove('copied');
                }, 1500);
            });
        };

        const tdReading = document.createElement('td');
        tdReading.innerText = displayReading;
        if (state.learningParams.hiddenCols.reading) tdReading.classList.add('hidden-text');
        tdReading.onclick = () => tdReading.classList.remove('hidden-text');

        const tdMean = document.createElement('td');
        let meanHTML = '';
        if (word.cnvi) {
            meanHTML += `<small class="cnvi-badge">${word.cnvi}</small>`;
        }
        meanHTML += `<div>${word.mean || ''}</div>`;
        tdMean.innerHTML = meanHTML;
        if (state.learningParams.hiddenCols.meaning) tdMean.classList.add('hidden-text');
        tdMean.onclick = () => tdMean.classList.remove('hidden-text');

        // Ngăn click lưu khi ở mode Review
        if (state.currentLesson === 'review') {
            showToast("Đây là bài ôn tập tổng hợp, vui lòng đánh dấu ở trong các bài học chi tiết.", "info");
            return;
        }

        // Star logic
        const tdStar = document.createElement('td');
        tdStar.style.textAlign = 'center';
        tdStar.innerHTML = `<i class="fas fa-star star-btn ${word.isHard ? 'hard' : ''}"></i>`;
        tdStar.onclick = () => {
            if (state.currentLesson === 'review') {
                showToast("Vui lòng vào chi tiết bài học để cập nhật từ khó.", "info");
                return;
            }
            // Update in array
            const targetWord = state.learningParams.words.find(w => w.id === word.id);
            if (targetWord) targetWord.isHard = !targetWord.isHard;
            // Update UI
            tdStar.querySelector('i').classList.toggle('hard');
        };

        tr.appendChild(tdWord);
        tr.appendChild(tdReading);
        tr.appendChild(tdMean);
        tr.appendChild(tdStar);

        tbody.appendChild(tr);
    });
}

function renderFlashcardMode(wordsArray) {
    if (wordsArray.length === 0) return;

    state.learningParams.fcIndex = 0;
    const fcCard = document.getElementById('flashcard');
    fcCard.classList.remove('is-flipped');

    updateFlashcardUI(wordsArray);

    document.getElementById('btn-fc-prev').onclick = () => {
        if (state.learningParams.fcIndex > 0) {
            state.learningParams.fcIndex--;
            fcCard.classList.remove('is-flipped');
            setTimeout(() => updateFlashcardUI(wordsArray), 300);
        }
    };
    document.getElementById('btn-fc-next').onclick = () => {
        if (state.learningParams.fcIndex < wordsArray.length - 1) {
            state.learningParams.fcIndex++;
            fcCard.classList.remove('is-flipped');
            setTimeout(() => updateFlashcardUI(wordsArray), 300);
        }
    };
    fcCard.onclick = () => {
        fcCard.classList.toggle('is-flipped');
    };
}

function updateFlashcardUI(wordsArray) {
    const word = wordsArray[state.learningParams.fcIndex];
    document.getElementById('fc-front').innerHTML = word.kanji || word.hira;
    document.getElementById('fc-back').innerHTML = `
        <div style="font-size: 1.5rem; margin-bottom:10px">${word.hira || ''}</div>
        <div style="color: #800020; font-size: 1rem; margin-bottom:10px">${word.cnvi || ''}</div>
        <div style="font-size: 1.2rem">${word.mean || ''}</div>
    `;
    document.getElementById('fc-counter').innerText = `${state.learningParams.fcIndex + 1} / ${wordsArray.length}`;
    document.getElementById('fc-sm2-counter').innerText = `${state.learningParams.fcIndex + 1} / ${wordsArray.length}`;

    // Cập nhật trạng thái sao cho thẻ hiện tại
    const starIcon = document.querySelector('#fc-star-btn .star-btn');
    if (word.isHard) starIcon.classList.add('hard');
    else starIcon.classList.remove('hard');

    document.getElementById('fc-star-btn').onclick = (e) => {
        e.stopPropagation(); // Tránh lật thẻ
        if (state.currentLesson === 'review') {
            showToast("Vui lòng vào chi tiết bài học để cập nhật từ khó.", "info");
            return;
        }
        word.isHard = !word.isHard;
        starIcon.classList.toggle('hard');
    };
}

function renderQuizMode(wordsArray) {
    if (wordsArray.length === 0) return;
    state.learningParams.quizIndex = 0;
    state.learningParams.quizScore = 0;

    // Tạo mảng câu hỏi trộn lên
    state.learningParams.quizQuestions = [...wordsArray].sort(() => 0.5 - Math.random());
    updateQuizUI();
}

function updateQuizUI() {
    const questions = state.learningParams.quizQuestions;
    const index = state.learningParams.quizIndex;

    if (index >= questions.length) {
        document.getElementById('quiz-question').innerHTML = `Hoàn thành! Bạn đúng ${state.learningParams.quizScore} / ${questions.length}`;
        document.getElementById('quiz-options').innerHTML = '';
        document.getElementById('btn-quiz-next').classList.add('hidden');
        return;
    }

    const currentQ = questions[index];
    document.getElementById('quiz-counter').innerText = `Câu: ${index + 1} / ${questions.length}`;
    document.getElementById('quiz-score').innerText = `Điểm: ${state.learningParams.quizScore}`;
    document.getElementById('quiz-question').innerText = currentQ.kanji || currentQ.hira;

    // Cập nhật sao cho câu hiện tại
    const starIcon = document.querySelector('#quiz-star-btn .star-btn');
    if (currentQ.isHard) starIcon.classList.add('hard');
    else starIcon.classList.remove('hard');

    document.getElementById('quiz-star-btn').onclick = () => {
        if (state.currentLesson === 'review') {
            showToast("Vui lòng vào chi tiết bài học để cập nhật từ khó.", "info");
            return;
        }
        currentQ.isHard = !currentQ.isHard;
        starIcon.classList.toggle('hard');
    };

    // Lấy 3 đáp án sai ngẫu nhiên
    let otherOptions = state.learningParams.words.filter(w => w.id !== currentQ.id);
    otherOptions = otherOptions.sort(() => 0.5 - Math.random()).slice(0, 3);

    let allOptions = [currentQ, ...otherOptions].sort(() => 0.5 - Math.random());

    const optionsContainer = document.getElementById('quiz-options');
    optionsContainer.innerHTML = '';

    let answered = false;
    const btnNext = document.getElementById('btn-quiz-next');
    btnNext.classList.add('hidden');

    allOptions.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'quiz-option';
        div.innerText = opt.mean; // Đố nghĩa
        div.onclick = () => {
            if (answered) return;
            answered = true;
            if (opt.id === currentQ.id) {
                div.classList.add('correct');
                state.learningParams.quizScore++;
                document.getElementById('quiz-score').innerText = `Điểm: ${state.learningParams.quizScore}`;
            } else {
                div.classList.add('wrong');
                // Highlight đáp án đúng
                Array.from(optionsContainer.children).forEach(child => {
                    if (child.innerText === currentQ.mean) child.classList.add('correct');
                });
            }
            btnNext.classList.remove('hidden');
        };
        optionsContainer.appendChild(div);
    });

    btnNext.onclick = () => {
        state.learningParams.quizIndex++;
        updateQuizUI();
    };
}


function showSpinner(show) {
    if (show) spinner.classList.remove('hidden');
    else spinner.classList.add('hidden');
}

// 7. Khởi tạo Event Listeners
document.getElementById('mode-select').onchange = (e) => {
    state.learningParams.mode = e.target.value;
    updateLearningView();
};

document.getElementById('btn-shuffle').onclick = () => {
    state.learningParams.words = state.learningParams.words.sort(() => 0.5 - Math.random());
    updateLearningView();
};

document.getElementById('btn-filter-hard').onclick = (e) => {
    const btn = e.currentTarget;
    btn.classList.toggle('active');
    state.learningParams.isHardFiltered = btn.classList.contains('active');
    updateLearningView();
};

document.querySelectorAll('.btn-toggle-col').forEach(btn => {
    btn.onclick = (e) => {
        const col = btn.getAttribute('data-col');
        state.learningParams.hiddenCols[col] = !state.learningParams.hiddenCols[col];
        btn.innerHTML = state.learningParams.hiddenCols[col] ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
        updateLearningView();
    };
});

document.querySelectorAll('.btn-grade').forEach(btn => {
    btn.onclick = async (e) => {
        const quality = parseInt(e.target.getAttribute('data-grade'));
        const word = state.learningParams.words[state.learningParams.fcIndex];

        // Tính toán SM2 mới
        const newSm2 = calculateSM2(quality, word.sm2);
        word.sm2 = newSm2;

        // Gom dữ liệu cập nhật vào pending object (không lưu lên FB ngay)
        const lessonId = word.lessonId;
        const wordId = word.id;

        if (!state.learningParams.pendingSM2Updates[lessonId]) {
            state.learningParams.pendingSM2Updates[lessonId] = {};
        }
        state.learningParams.pendingSM2Updates[lessonId][`${wordId}/sm2`] = newSm2;

        // Chuyển thẻ tiếp theo
        const fcCard = document.getElementById('flashcard');
        if (state.learningParams.fcIndex < state.learningParams.words.length - 1) {
            state.learningParams.fcIndex++;
            fcCard.classList.remove('is-flipped');
            setTimeout(() => updateFlashcardUI(state.learningParams.words), 300);
        } else {
            // Đã đến từ cuối cùng -> Gửi toàn bộ pending updates lên Firebase trong 1 LẦN duy nhất
            showSpinner(true);
            try {
                const type = state.currentType;
                const level = state.currentLevel;
                const updates = {};

                // Gom tất cả các lesson bị thay đổi thành 1 cục batch update
                for (const lId in state.learningParams.pendingSM2Updates) {
                    const wordUpdates = state.learningParams.pendingSM2Updates[lId];
                    for (const wPath in wordUpdates) {
                        updates[`tuannv_new/content/${type}/${level}/${lId}/${wPath}`] = wordUpdates[wPath];
                    }
                    // Xóa cache của bài học đó để load lại dữ liệu mới nhất
                    delete state.cache.words[`${type}_${level}_${lId}`];
                }

                await update(ref(db), updates);

                showToast("Chúc mừng! Bạn đã hoàn thành phiên ôn tập.", "success");
                setTimeout(() => {
                    switchView('lesson');
                }, 1500);
            } catch (error) {
                console.error(error);
                showToast("Không thể lưu tiến độ SM2!", "error");
            } finally {
                showSpinner(false);
            }
        }
    };
});

document.getElementById('btn-save-progress').onclick = async () => {
    const type = state.currentType;
    const level = state.currentLevel;
    const lessonId = state.currentLesson;

    // Convert array back to object structure for Firebase
    const wordsObj = {};
    let hardCount = 0;
    state.learningParams.words.forEach(w => {
        wordsObj[w.id] = { kanji: w.kanji || '', hira: w.hira || '', cnvi: w.cnvi || '', mean: w.mean || '', isHard: w.isHard || false };
        if (w.isHard) hardCount++;
    });

    const now = new Date();
    const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

    showSpinner(true);
    try {
        await set(ref(db, `tuannv_new/content/${type}/${level}/${lessonId}`), wordsObj);

        // Cập nhật metadata (ngày học + số từ khó)
        await set(child(ref(db), `tuannv_new/metadata/${type}/${level}/lessons/${lessonId}/hardCount`), hardCount);
        await set(child(ref(db), `tuannv_new/metadata/${type}/${level}/lessons/${lessonId}/lastLearned`), dateStr);

        // Xóa cache
        delete state.cache.words[`${type}_${level}_${lessonId}`];
        delete state.cache.lessons[`${type}_${level}`];

        showToast("Đã lưu tiến độ học thành công!", 'success');
        switchView('lesson'); // Quay về màn hình danh sách bài học
        fetchLessons(level); // Tải lại danh sách để cập nhật ngày học & số từ khó mới
    } catch (error) {
        console.error(error);
        showToast("Lỗi khi lưu tiến độ!", 'error');
    } finally {
        showSpinner(false);
    }
};

document.querySelectorAll('.btn-type').forEach(btn => {
    btn.addEventListener('click', async () => {
        document.querySelectorAll('.btn-type').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentType = btn.getAttribute('data-type');

        // Khi đổi Tab Từ vựng <-> Kanji, tự động tải lại danh sách bài học của Level hiện tại
        if (state.currentLevel) {
            let isFetchSuccess = await fetchLessons(state.currentLevel);
            if (!isFetchSuccess && state.currentType != 'vocab') {
                resetButtonDataTypeToVocal();
            }
        }
    });
});

function resetButtonDataTypeToVocal() {
    document.querySelectorAll('.btn-type').forEach(b => b.classList.remove('active'));
    document.querySelector('.btn-type[data-type="vocab"]').classList.add('active');
    state.currentType = 'vocab';
}

document.querySelectorAll('.btn-level').forEach(btn => {
    btn.addEventListener('click', () => {
        const level = btn.getAttribute('data-level');
        localStorage.setItem('jp_last_level', level); // Lưu level vào localStorage
        state.currentLevel = level;

        // Reset lại Tab về Từ vựng mỗi khi đổi Level mới
        resetButtonDataTypeToVocal();

        fetchLessons(level);
    });
});

document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
        if (state.currentView === 'learning') switchView('lesson');
        else if (state.currentView === 'lesson') switchView('dashboard');
    });
});

const btnSelectLevel = document.getElementById('btn-select-level');
if (btnSelectLevel) {
    btnSelectLevel.onclick = () => {
        switchView('dashboard');
    };
}

// Khởi tạo ứng dụng
const savedLevel = localStorage.getItem('jp_last_level');
if (savedLevel) {
    fetchLessons(savedLevel);
}
