const messageEl = document.getElementById('message');

function showMessage(message, isError = false) {
    messageEl.textContent = message;
    messageEl.className = isError ? 'error' : 'success';
}

async function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
        await apiRequest('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        showMessage('로그인 성공! 로비로 이동합니다.');
        window.location.href = 'pages/lobby.html';
    } catch (error) {
        showMessage(error.message, true);
    }
}

async function handleRegister() {
    const username = document.getElementById('registerUsername').value.trim();
    const nickname = document.getElementById('registerNickname').value.trim();
    const password = document.getElementById('registerPassword').value;

    try {
        await apiRequest('/api/register', {
            method: 'POST',
            body: JSON.stringify({ username, nickname, password })
        });
        showMessage('회원가입 완료! 로그인해 주세요.');
    } catch (error) {
        showMessage(error.message, true);
    }
}

document.getElementById('loginBtn').addEventListener('click', handleLogin);
document.getElementById('registerBtn').addEventListener('click', handleRegister);
