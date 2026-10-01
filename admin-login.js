// Check if already logged in
if (localStorage.getItem('adminToken')) {
    window.location.href = '/admin.html';
}

// Initialize form on page load
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
        console.log('✅ Login form initialized');
    }
});

// Show an error as plain text: a bold title and an optional detail line
function showLoginError(title, detail) {
    const errorMsg = document.getElementById('error-message');
    const strong = document.createElement('strong');
    strong.textContent = '\u274C ' + title;
    errorMsg.replaceChildren(strong);
    if (detail) {
        const small = document.createElement('small');
        small.textContent = detail;
        errorMsg.append(document.createElement('br'), small);
    }
    errorMsg.classList.add('show');
}

async function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('login-btn');
    const errorMsg = document.getElementById('error-message');
    const successMsg = document.getElementById('success-message');

    // Clear previous messages
    errorMsg.classList.remove('show');
    successMsg.classList.remove('show');

    // Validate input
    if (!username || !password) {
        errorMsg.innerHTML = '❌ <strong>Please enter both username and password</strong>';
        errorMsg.classList.add('show');
        return;
    }

    // Disable button
    loginBtn.disabled = true;
    loginBtn.classList.add('loading');
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';

    try {
        console.log('Attempting login with username:', username);

        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        console.log('Response status:', response.status);

        // Check if response is OK
        if (!response.ok) {
            // The server says why (e.g. "still uses the default password",
            // "database not connected"); show that instead of a generic message.
            let body = {};
            try { body = await response.json(); } catch (e) { /* not JSON */ }
            const reason = body.message || '';

            if (response.status === 429) {
                showLoginError('Too many login attempts', 'Please wait about 15 minutes before trying again.');
            } else if (response.status === 401) {
                showLoginError('Invalid username or password', 'Please check your details and try again.');
            } else if (response.status === 403) {
                showLoginError('This account cannot sign in yet', reason || 'Ask the site administrator to reset the password.');
            } else if (response.status === 503) {
                showLoginError('Sign-in is temporarily unavailable', reason || 'The server could not reach its database. Please try again shortly.');
            } else if (response.status === 400) {
                const first = body.errors && body.errors[0] ? body.errors[0].message : reason;
                showLoginError('Please check what you entered', first || 'The username or password is not in a valid format.');
            } else if (response.status >= 500) {
                showLoginError('Server error', 'The server is having issues. Please try again later.');
            } else {
                showLoginError('Login failed (error ' + response.status + ')', 'Please try again.');
            }

            // Re-enable button
            loginBtn.disabled = false;
            loginBtn.classList.remove('loading');
            loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login to Admin Console';
            return;
        }

        const data = await response.json();
        console.log('Login response:', data);

        if (data.success) {
            // Store token
            localStorage.setItem('adminToken', data.token);
            localStorage.setItem('adminUsername', data.username);

            // Show success message
            successMsg.classList.add('show');

            // Redirect to admin dashboard
            setTimeout(() => {
                window.location.href = '/admin.html';
            }, 1000);
        } else {
            showLoginError(data.message || 'Login failed', '');

            // Re-enable button
            loginBtn.disabled = false;
            loginBtn.classList.remove('loading');
            loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login to Admin Console';
        }
    } catch (error) {
        console.error('Login error:', error);

        let errorText = 'Unable to connect to the server';

        if (error.message.includes('Failed to fetch')) {
            errorText = 'Cannot reach the server. Please check your internet connection';
        } else if (error.message.includes('network')) {
            errorText = 'Network error. Please check your connection';
        }

        showLoginError(errorText, '');
        errorMsg.classList.add('show');

        // Re-enable button
        loginBtn.disabled = false;
        loginBtn.classList.remove('loading');
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login to Admin Console';
    }
}
