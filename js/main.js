function requireLogin() {
    return apiRequest('/api/me')
        .then(({ user }) => user)
        .catch(() => {
            window.location.href = '../index.html';
        });
}

async function logout() {
    await apiRequest('/api/logout', { method: 'POST' });
    window.location.href = '../index.html';
}

function bindLogoutButton() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
}

document.addEventListener('DOMContentLoaded', bindLogoutButton);
