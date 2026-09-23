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
            if (response.status === 429) {
                errorMsg.innerHTML = '⏳ <strong>Too many login attempts</strong><br><small>Please wait a few minutes before trying again</small>';
            } else if (response.status === 401 || response.status === 403) {
                errorMsg.innerHTML = '❌ <strong>Invalid username or password</strong><br><small>Please check your credentials and try again</small>';
            } else if (response.status === 500) {
                errorMsg.innerHTML = '⚠️ <strong>Server error</strong><br><small>The server is having issues. Please try again later</small>';
            } else {
                errorMsg.innerHTML = `❌ <strong>Login failed (Error ${response.status})</strong><br><small>Please try again</small>`;
            }
            errorMsg.classList.add('show');

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
            // Show specific error messages
            let errorText = data.message || 'Invalid credentials';

            if (data.message.includes('Invalid credentials')) {
                errorMsg.innerHTML = '❌ <strong>Invalid username or password</strong><br><small>Username: admin<br>Password: admin123</small>';
            } else if (data.message.includes('Database required')) {
                errorMsg.innerHTML = '⚠️ <strong>System initialization in progress</strong><br><small>Please wait a moment and try again</small>';
            } else {
                errorMsg.innerHTML = `❌ <strong>${errorText}</strong>`;
            }

            errorMsg.classList.add('show');

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

        errorMsg.innerHTML = `❌ <strong>${errorText}</strong><br><small>Console error: ${error.message}</small>`;
        errorMsg.classList.add('show');

        // Re-enable button
        loginBtn.disabled = false;
        loginBtn.classList.remove('loading');
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login to Admin Console';
    }
}
