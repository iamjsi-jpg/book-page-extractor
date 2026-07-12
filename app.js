/**
 * 책 페이지 추출기 - 브라우저 앱
 *
 * 영상에서 고유 페이지를 추출하고, OCR로 텍스트를 인식한 후
 * Google Docs로 내보내는 클라이언트 사이드 웹 앱입니다.
 */

// ============================================================
// Google API 설정
// ============================================================
// 아래 CLIENT_ID를 본인의 Google Cloud OAuth 2.0 클라이언트 ID로 교체하세요.
// API_KEY는 Google Cloud Console에서 발급받은 API 키로 교체하세요.
const GOOGLE_CLIENT_ID = '659226329113-gtt1ucguk8imff0nstvk99qij6up7731.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'YOUR_API_KEY';
const SCOPES = 'https://www.googleapis.com/auth/documents';
// Cloud Vision API 키 (OCR용) - 위 API_KEY와 동일하게 사용 가능
const VISION_API_KEY = 'AIzaSyA_JZJrMd8ybmWHftR7HczBwLdmvcWJQ0A';

// ============================================================
// 상태 관리
// ============================================================
const state = {
    videoFile: null,
    videoUrl: null,
    pages: [],        // { imageData, dataUrl }
    pageTexts: [],    // { pageNum, text }
    isProcessing: false,
    googleToken: null,
};

// ============================================================
// DOM 요소
// ============================================================
const elements = {
    uploadArea: document.getElementById('upload-area'),
    videoInput: document.getElementById('video-input'),
    videoInfo: document.getElementById('video-info'),
    videoPreview: document.getElementById('video-preview'),
    fileName: document.getElementById('file-name'),
    videoDuration: document.getElementById('video-duration'),
    stepSettings: document.getElementById('step-settings'),
    stepProcessing: document.getElementById('step-processing'),
    stepResult: document.getElementById('step-result'),
    similarityThreshold: document.getElementById('similarity-threshold'),
    thresholdValue: document.getElementById('threshold-value'),
    frameInterval: document.getElementById('frame-interval'),
    intervalValue: document.getElementById('interval-value'),
    ocrLang: document.getElementById('ocr-lang'),
    docTitle: document.getElementById('doc-title'),
    btnStart: document.getElementById('btn-start'),
    progressExtract: document.getElementById('progress-extract'),
    progressOcr: document.getElementById('progress-ocr'),
    statusExtract: document.getElementById('status-extract'),
    statusOcr: document.getElementById('status-ocr'),
    logArea: document.getElementById('log-area'),
    resultPages: document.getElementById('result-pages'),
    resultChars: document.getElementById('result-chars'),
    resultPagesGrid: document.getElementById('result-pages-grid'),
    btnUploadGdocs: document.getElementById('btn-upload-gdocs'),
    btnDownloadTxt: document.getElementById('btn-download-txt'),
    btnRestart: document.getElementById('btn-restart'),
    frameCanvas: document.getElementById('frame-canvas'),
    compareCanvas: document.getElementById('compare-canvas'),
};

// ============================================================
// 이벤트 리스너
// ============================================================
function initEventListeners() {
    // 업로드 영역
    elements.uploadArea.addEventListener('click', () => elements.videoInput.click());
    elements.uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.uploadArea.classList.add('dragover');
    });
    elements.uploadArea.addEventListener('dragleave', () => {
        elements.uploadArea.classList.remove('dragover');
    });
    elements.uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleVideoFile(e.dataTransfer.files[0]);
        }
    });
    elements.videoInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleVideoFile(e.target.files[0]);
        }
    });

    // 설정 슬라이더
    elements.similarityThreshold.addEventListener('input', (e) => {
        elements.thresholdValue.textContent = e.target.value;
    });
    elements.frameInterval.addEventListener('input', (e) => {
        elements.intervalValue.textContent = `${e.target.value}초`;
    });

    // 버튼
    elements.btnStart.addEventListener('click', startProcessing);
    elements.btnUploadGdocs.addEventListener('click', uploadToGoogleDocs);
    elements.btnDownloadTxt.addEventListener('click', downloadAsText);
    elements.btnRestart.addEventListener('click', restart);
}

// ============================================================
// 영상 파일 처리
// ============================================================
function handleVideoFile(file) {
    if (!file.type.startsWith('video/')) {
        alert('영상 파일만 업로드할 수 있습니다.');
        return;
    }

    state.videoFile = file;
    state.videoUrl = URL.createObjectURL(file);

    elements.videoPreview.src = state.videoUrl;
    elements.fileName.textContent = file.name;

    elements.videoPreview.addEventListener('loadedmetadata', () => {
        const duration = elements.videoPreview.duration;
        const minutes = Math.floor(duration / 60);
        const seconds = Math.floor(duration % 60);
        elements.videoDuration.textContent = `${minutes}분 ${seconds}초`;
    });

    elements.videoInfo.classList.remove('hidden');
    elements.stepSettings.classList.remove('hidden');

    // 문서 제목에 파일명 반영
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    elements.docTitle.value = baseName;
}

// ============================================================
// 로그
// ============================================================
function log(message) {
    const p = document.createElement('p');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    elements.logArea.appendChild(p);
    elements.logArea.scrollTop = elements.logArea.scrollHeight;

    // placeholder 제거
    const placeholder = elements.logArea.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();
}

// ============================================================
// 메인 처리 파이프라인
// ============================================================
async function startProcessing() {
    if (state.isProcessing) return;
    state.isProcessing = true;
    state.pages = [];
    state.pageTexts = [];

    elements.btnStart.disabled = true;
    elements.stepProcessing.classList.remove('hidden');
    elements.logArea.innerHTML = '';

    try {
        // 1단계: 페이지 추출
        log('페이지 추출을 시작합니다...');
        elements.statusExtract.textContent = '진행중';
        elements.statusExtract.classList.add('active');

        await extractPages();

        elements.statusExtract.textContent = `완료 (${state.pages.length}페이지)`;
        elements.statusExtract.classList.remove('active');
        elements.statusExtract.classList.add('done');
        elements.progressExtract.style.width = '100%';

        if (state.pages.length === 0) {
            log('⚠️ 추출된 페이지가 없습니다. 설정을 조정해 보세요.');
            state.isProcessing = false;
            elements.btnStart.disabled = false;
            return;
        }

        // 2단계: OCR
        log('OCR 텍스트 인식을 시작합니다...');
        elements.statusOcr.textContent = '진행중';
        elements.statusOcr.classList.add('active');

        await performOCR();

        elements.statusOcr.textContent = `완료 (${state.pageTexts.length}페이지)`;
        elements.statusOcr.classList.remove('active');
        elements.statusOcr.classList.add('done');
        elements.progressOcr.style.width = '100%';

        // 결과 표시
        showResults();

    } catch (error) {
        log(`❌ 오류 발생: ${error.message}`);
        console.error(error);
    }

    state.isProcessing = false;
    elements.btnStart.disabled = false;
}

// ============================================================
// 페이지 추출 (SSIM 기반 중복 감지)
// ============================================================
async function extractPages() {
    const video = document.createElement('video');
    video.src = state.videoUrl;
    video.muted = true;
    video.preload = 'auto';

    await new Promise((resolve, reject) => {
        video.addEventListener('loadeddata', resolve, { once: true });
        video.addEventListener('error', reject, { once: true });
        video.load();
    });

    const duration = video.duration;
    const interval = parseFloat(elements.frameInterval.value);
    const threshold = parseFloat(elements.similarityThreshold.value);

    log(`  영상 길이: ${duration.toFixed(1)}초, 간격: ${interval}초`);

    const canvas = elements.frameCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // 분석용 해상도
    const analyzeWidth = 320;
    const analyzeHeight = 240;
    canvas.width = analyzeWidth;
    canvas.height = analyzeHeight;

    // 원본 해상도 캡처용 캔버스
    const fullCanvas = elements.compareCanvas;
    const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });

    // 단순화된 접근: 각 시간에 프레임을 캡처하고, 이전에 저장된 페이지와 비교
    // 유사도가 threshold 이하면 새 페이지로 저장
    let lastSavedPixels = null;

    for (let t = 0; t <= duration; t += interval) {
        // 프레임 탐색
        video.currentTime = t;
        await new Promise((resolve) => {
            video.addEventListener('seeked', resolve, { once: true });
        });

        // 약간의 딜레이 (프레임 렌더 대기)
        await new Promise(r => setTimeout(r, 100));

        // 분석용 프레임 그리기
        ctx.drawImage(video, 0, 0, analyzeWidth, analyzeHeight);
        const currentPixels = ctx.getImageData(0, 0, analyzeWidth, analyzeHeight);

        // 원본 해상도 프레임
        fullCanvas.width = video.videoWidth;
        fullCanvas.height = video.videoHeight;
        fullCtx.drawImage(video, 0, 0);
        const currentFullDataUrl = fullCanvas.toDataURL('image/png');

        const progress = Math.round((t / duration) * 100);
        elements.progressExtract.style.width = `${progress}%`;

        // 첫 프레임은 무조건 저장
        if (!lastSavedPixels) {
            state.pages.push({
                imageData: currentPixels,
                dataUrl: currentFullDataUrl,
            });
            lastSavedPixels = currentPixels;
            log(`  📄 페이지 ${state.pages.length} 추출 (t=${t.toFixed(1)}s)`);
            continue;
        }

        // 마지막으로 저장된 페이지와 비교
        const similarity = computeSSIM(currentPixels, lastSavedPixels);

        // 유사도가 임계값보다 낮으면 = 다른 페이지
        if (similarity < threshold) {
            // 추가로 이미 저장된 모든 페이지와 중복 확인
            const isDuplicate = checkDuplicate(currentPixels, threshold);
            if (!isDuplicate) {
                state.pages.push({
                    imageData: currentPixels,
                    dataUrl: currentFullDataUrl,
                });
                lastSavedPixels = currentPixels;
                log(`  📄 페이지 ${state.pages.length} 추출 (t=${t.toFixed(1)}s)`);
            }
        }
    }

    log(`✅ 총 ${state.pages.length}개의 고유 페이지를 추출했습니다.`);
}

/**
 * 이미 저장된 페이지들과 비교하여 중복 여부를 확인합니다.
 */
function checkDuplicate(pixels, threshold) {
    for (const page of state.pages) {
        const sim = computeSSIM(pixels, page.imageData);
        if (sim > threshold) {
            return true;
        }
    }
    return false;
}

/**
 * 간소화된 SSIM (Structural Similarity Index) 계산.
 * 그레이스케일 기반으로 두 이미지의 구조적 유사도를 측정합니다.
 */
function computeSSIM(imgData1, imgData2) {
    const data1 = imgData1.data;
    const data2 = imgData2.data;
    const len = Math.min(data1.length, data2.length) / 4;

    if (len === 0) return 0;

    let sum1 = 0, sum2 = 0;
    let sum1Sq = 0, sum2Sq = 0;
    let sumProduct = 0;

    for (let i = 0; i < len; i++) {
        const idx = i * 4;
        // 그레이스케일 변환
        const g1 = data1[idx] * 0.299 + data1[idx + 1] * 0.587 + data1[idx + 2] * 0.114;
        const g2 = data2[idx] * 0.299 + data2[idx + 1] * 0.587 + data2[idx + 2] * 0.114;

        sum1 += g1;
        sum2 += g2;
        sum1Sq += g1 * g1;
        sum2Sq += g2 * g2;
        sumProduct += g1 * g2;
    }

    const mean1 = sum1 / len;
    const mean2 = sum2 / len;
    const var1 = sum1Sq / len - mean1 * mean1;
    const var2 = sum2Sq / len - mean2 * mean2;
    const covar = sumProduct / len - mean1 * mean2;

    const c1 = (0.01 * 255) ** 2;
    const c2 = (0.03 * 255) ** 2;

    const numerator = (2 * mean1 * mean2 + c1) * (2 * covar + c2);
    const denominator = (mean1 ** 2 + mean2 ** 2 + c1) * (var1 + var2 + c2);

    return numerator / denominator;
}

// ============================================================
// OCR (Google Cloud Vision API)
// ============================================================
async function performOCR() {
    if (VISION_API_KEY === 'YOUR_VISION_API_KEY') {
        alert('Cloud Vision API 키가 설정되지 않았습니다.\napp.js 상단의 VISION_API_KEY를 교체하세요.');
        return;
    }

    log(`  Google Cloud Vision API 사용`);

    for (let i = 0; i < state.pages.length; i++) {
        const page = state.pages[i];
        const progress = Math.round(((i + 1) / state.pages.length) * 100);
        elements.progressOcr.style.width = `${progress}%`;

        log(`  [${i + 1}/${state.pages.length}] 페이지 ${i + 1} OCR 처리 중...`);

        try {
            // dataUrl에서 base64 부분만 추출
            const base64Image = page.dataUrl.split(',')[1];

            const requestBody = {
                requests: [{
                    image: { content: base64Image },
                    features: [{ type: 'TEXT_DETECTION' }],
                }]
            };

            const response = await fetch(
                `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                }
            );

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error?.message || `API 오류: ${response.status}`);
            }

            const data = await response.json();
            const annotation = data.responses[0]?.fullTextAnnotation;
            const text = annotation?.text?.trim() || '';

            if (text) {
                state.pageTexts.push({
                    pageNum: i + 1,
                    text: text,
                });
                log(`    → ${text.length}자 인식됨`);
            } else {
                log(`    → 텍스트를 인식하지 못했습니다`);
            }
        } catch (err) {
            log(`    ⚠️ OCR 실패: ${err.message}`);
        }
    }

    log(`✅ OCR 완료: ${state.pageTexts.length}개 페이지에서 텍스트 인식 성공`);
}

// ============================================================
// 결과 표시
// ============================================================
function showResults() {
    elements.stepResult.classList.remove('hidden');

    // 통계
    document.getElementById('result-pages').textContent = state.pages.length;
    const totalChars = state.pageTexts.reduce((sum, p) => sum + p.text.length, 0);
    elements.resultChars.textContent = totalChars.toLocaleString();

    // 페이지 그리드
    elements.resultPagesGrid.innerHTML = '';
    state.pages.forEach((page, idx) => {
        const pageText = state.pageTexts.find(p => p.pageNum === idx + 1);
        const card = document.createElement('div');
        card.className = 'page-card';
        card.innerHTML = `
            <img src="${page.dataUrl}" alt="페이지 ${idx + 1}">
            <div class="page-card-info">
                <h4>페이지 ${idx + 1}</h4>
                <p>${pageText ? pageText.text.substring(0, 50) + '...' : '텍스트 없음'}</p>
            </div>
        `;
        elements.resultPagesGrid.appendChild(card);
    });
}

// ============================================================
// Google Docs 업로드
// ============================================================
async function uploadToGoogleDocs() {
    if (state.pageTexts.length === 0) {
        alert('업로드할 텍스트가 없습니다.');
        return;
    }

    try {
        // Google 인증
        log('Google 계정 인증 중...');
        const token = await getGoogleToken();

        if (!token) {
            log('❌ Google 인증에 실패했습니다.');
            return;
        }

        const title = elements.docTitle.value || '추출된 책 내용';

        // 문서 생성
        log('Google Docs 문서를 생성합니다...');
        const createResponse = await fetch('https://docs.googleapis.com/v1/documents', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title }),
        });

        if (!createResponse.ok) {
            throw new Error(`문서 생성 실패: ${createResponse.status}`);
        }

        const doc = await createResponse.json();
        const docId = doc.documentId;

        // 텍스트 삽입
        let fullContent = '';
        for (const { pageNum, text } of state.pageTexts) {
            fullContent += `── 페이지 ${pageNum} ──\n\n${text}\n\n\n`;
        }

        const requests = [{
            insertText: {
                location: { index: 1 },
                text: fullContent,
            }
        }];

        const updateResponse = await fetch(
            `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ requests }),
            }
        );

        if (!updateResponse.ok) {
            throw new Error(`텍스트 삽입 실패: ${updateResponse.status}`);
        }

        const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
        log(`✅ Google Docs 업로드 완료!`);
        log(`📄 문서 URL: ${docUrl}`);

        // 새 탭에서 문서 열기
        window.open(docUrl, '_blank');

    } catch (error) {
        log(`❌ 업로드 오류: ${error.message}`);
        console.error(error);
    }
}

/**
 * Google OAuth 토큰을 가져옵니다.
 */
function getGoogleToken() {
    return new Promise((resolve) => {
        if (GOOGLE_CLIENT_ID === 'YOUR_CLIENT_ID.apps.googleusercontent.com') {
            alert(
                'Google API 설정이 필요합니다.\n\n' +
                '1. Google Cloud Console에서 OAuth 2.0 클라이언트 ID를 생성하세요.\n' +
                '2. app.js 파일 상단의 GOOGLE_CLIENT_ID를 교체하세요.\n' +
                '3. Google Docs API를 활성화하세요.\n\n' +
                '자세한 설정 방법은 README.md를 참고하세요.'
            );
            resolve(null);
            return;
        }

        const tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: (response) => {
                if (response.error) {
                    resolve(null);
                } else {
                    state.googleToken = response.access_token;
                    resolve(response.access_token);
                }
            },
        });

        tokenClient.requestAccessToken();
    });
}

// ============================================================
// 텍스트 파일 다운로드
// ============================================================
function downloadAsText() {
    if (state.pageTexts.length === 0) {
        alert('다운로드할 텍스트가 없습니다.');
        return;
    }

    let content = '';
    for (const { pageNum, text } of state.pageTexts) {
        content += `=== 페이지 ${pageNum} ===\n`;
        content += text;
        content += '\n\n';
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${elements.docTitle.value || '추출된_텍스트'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    log('📥 텍스트 파일을 다운로드했습니다.');
}

// ============================================================
// 재시작
// ============================================================
function restart() {
    state.videoFile = null;
    state.pages = [];
    state.pageTexts = [];
    state.isProcessing = false;

    if (state.videoUrl) {
        URL.revokeObjectURL(state.videoUrl);
        state.videoUrl = null;
    }

    elements.videoInfo.classList.add('hidden');
    elements.stepSettings.classList.add('hidden');
    elements.stepProcessing.classList.add('hidden');
    elements.stepResult.classList.add('hidden');

    elements.progressExtract.style.width = '0%';
    elements.progressOcr.style.width = '0%';
    elements.statusExtract.textContent = '대기중';
    elements.statusExtract.classList.remove('active', 'done');
    elements.statusOcr.textContent = '대기중';
    elements.statusOcr.classList.remove('active', 'done');
    elements.logArea.innerHTML = '<p class="log-placeholder">처리 로그가 여기에 표시됩니다...</p>';
    elements.resultPagesGrid.innerHTML = '';
    elements.videoInput.value = '';
}

// ============================================================
// 초기화
// ============================================================
initEventListeners();
