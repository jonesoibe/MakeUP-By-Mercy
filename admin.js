// Global variables
let allBookings = [];
let currentBookingId = null;
let bookingPrices = {
    bridal: 25000,
    party: 15000,
    casual: 10000
};

// Admin authentication check
window.addEventListener('load', () => {
    const adminToken = localStorage.getItem('adminToken');
    if (!adminToken) {
        window.location.href = '/admin-login.html';
    }

    const usernameDisplay = document.getElementById('admin-username-display');
    if (usernameDisplay) {
        usernameDisplay.textContent = localStorage.getItem('adminUsername') || 'Admin';
    }

    loadDashboardData();
});

// Initialize all event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Menu navigation - attach listeners to menu links
    console.log('Attaching menu click listeners...');
    document.querySelectorAll('.menu-link').forEach(link => {
        link.addEventListener('click', (e) => {
            console.log('Menu link clicked:', e.currentTarget.dataset.section);
            e.preventDefault();
            const section = e.currentTarget.dataset.section;
            switchSection(section);
        });
    });
    console.log('✅ Menu navigation initialized');

    // Add event listeners for buttons
    const savePricingBtn = document.getElementById('save-pricing-btn');
    if (savePricingBtn) {
        savePricingBtn.addEventListener('click', savePricing);
        console.log('✅ Save Pricing button listener attached');
    }

    const saveEmailTemplateBtn = document.getElementById('save-email-template-btn');
    if (saveEmailTemplateBtn) {
        saveEmailTemplateBtn.addEventListener('click', saveEmailTemplate);
        console.log('✅ Save Email Template button listener attached');
    }

    // Close any open modal on Escape key, routing through each modal's own
    // close function so related state (currentBookingId, message text) is
    // reset the same way a click on its close button would reset it.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.getElementById('message-modal').classList.contains('show')) {
            closeMessageModal();
        }
        if (document.getElementById('booking-modal').classList.contains('show')) {
            closeBookingModal();
        }
    });

    // Close a modal when clicking its backdrop (outside the modal content)
    document.getElementById('booking-modal').addEventListener('click', (e) => {
        if (e.target.id === 'booking-modal') closeBookingModal();
    });
    document.getElementById('message-modal').addEventListener('click', (e) => {
        if (e.target.id === 'message-modal') closeMessageModal();
    });

    // Manage tab: live search by booking number or customer name
    const searchBookingInput = document.getElementById('search-booking');
    if (searchBookingInput) {
        searchBookingInput.addEventListener('input', (e) => {
            renderManageResults(e.target.value.trim());
        });
        console.log('✅ Manage tab search box listener attached');
    }

    console.log('✅ Admin panel initialized with all event listeners');
});

function switchSection(section) {
    // Hide all sections
    document.querySelectorAll('section').forEach(s => s.style.display = 'none');

    // Remove active class from menu
    document.querySelectorAll('.menu-link').forEach(link => link.classList.remove('active'));

    // Show selected section
    document.getElementById(section + '-section').style.display = 'block';
    document.querySelector(`[data-section="${section}"]`).classList.add('active');

    // Update title
    const titles = {
        dashboard: 'Dashboard',
        bookings: 'Bookings Management',
        analytics: 'Analytics',
        settings: 'Settings'
    };
    document.getElementById('page-title').textContent = titles[section];

    // Load section data
    if (section === 'bookings') {
        loadAllBookings();
    } else if (section === 'analytics') {
        loadAnalytics();
    } else if (section === 'settings') {
        loadAvailability();
        loadPricing();
    }
}

function switchTab(tabName) {
    // Hide all tabs in the container
    const tabs = event.target.parentElement.parentElement.querySelectorAll('.tab-content');
    tabs.forEach(t => t.classList.remove('active'));

    // Remove active class from buttons
    event.target.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

    // Show selected tab
    document.getElementById(tabName + '-tab').classList.add('active');
    event.target.classList.add('active');

    // Load email template when tab is opened
    if (tabName === 'email-templates') {
        loadEmailTemplate();
    } else if (tabName === 'manage') {
        renderManageResults(document.getElementById('search-booking').value.trim());
    }
}

async function loadDashboardData() {
    try {
        const response = await fetch('/api/admin/dashboard', {
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken')
            }
        });
        const data = await response.json();

        if (data.success) {
            // Update stats
            document.getElementById('total-bookings').textContent = data.totalBookings;
            document.getElementById('confirmed-bookings').textContent = data.confirmedBookings;
            document.getElementById('revenue').textContent = '₦' + (data.monthlyRevenue || 0).toLocaleString();
            document.getElementById('repeat-customers').textContent = data.repeatCustomers;

            // Load upcoming appointments
            loadUpcomingAppointments();
            loadRecentBookings();
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

async function loadUpcomingAppointments() {
    try {
        const response = await fetch('/api/admin/appointments/upcoming', {
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken')
            }
        });
        const data = await response.json();

        let html = '<table class="bookings-table"><thead><tr><th>Date</th><th>Client</th><th>Service</th><th>Phone</th><th>Status</th></tr></thead><tbody>';

        if (data.appointments && data.appointments.length > 0) {
            data.appointments.forEach(apt => {
                const dateObj = new Date(apt.date);
                const dateStr = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                html += `<tr>
                    <td>${dateStr}</td>
                    <td>${apt.name}</td>
                    <td>${apt.service.charAt(0).toUpperCase() + apt.service.slice(1)}</td>
                    <td>${apt.phone}</td>
                    <td><span class="status-badge status-${apt.status}">${apt.status}</span></td>
                </tr>`;
            });
        } else {
            html += '<tr><td colspan="5" style="text-align: center; padding: 30px;">No upcoming appointments</td></tr>';
        }

        html += '</tbody></table>';
        document.getElementById('upcoming-appointments').innerHTML = html;
    } catch (error) {
        console.error('Error loading appointments:', error);
        document.getElementById('upcoming-appointments').innerHTML = '<p style="color: #e74c3c;">Error loading appointments</p>';
    }
}

async function loadRecentBookings() {
    try {
        const response = await fetch('/api/admin/bookings/recent', {
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken')
            }
        });
        const data = await response.json();

        let html = '<table class="bookings-table"><thead><tr><th>Booking ID</th><th>Client</th><th>Email</th><th>Service</th><th>Date</th><th>Action</th></tr></thead><tbody>';

        if (data.bookings && data.bookings.length > 0) {
            data.bookings.forEach(booking => {
                const dateObj = new Date(booking.date);
                const dateStr = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                html += `<tr>
                    <td><strong>${booking.bookingNumber}</strong></td>
                    <td>${booking.name}</td>
                    <td>${booking.email}</td>
                    <td>${booking.service.charAt(0).toUpperCase() + booking.service.slice(1)}</td>
                    <td>${dateStr}</td>
                    <td><button class="btn btn-sm btn-primary" onclick="openBookingModal('${booking._id}')">View</button></td>
                </tr>`;
            });
        } else {
            html += '<tr><td colspan="6" style="text-align: center; padding: 30px;">No bookings yet</td></tr>';
        }

        html += '</tbody></table>';
        document.getElementById('recent-bookings').innerHTML = html;
    } catch (error) {
        console.error('Error loading recent bookings:', error);
        document.getElementById('recent-bookings').innerHTML = '<p style="color: #e74c3c;">Error loading bookings</p>';
    }
}

async function loadAllBookings() {
    try {
        const response = await fetch('/api/admin/bookings', {
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken')
            }
        });
        const data = await response.json();

        if (data.success) {
            allBookings = data.bookings;
            displayBookingsTable(allBookings);
        }
    } catch (error) {
        console.error('Error loading bookings:', error);
    }
}

function displayBookingsTable(bookings) {
    let html = '<table class="bookings-table"><thead><tr><th>Booking ID</th><th>Client</th><th>Email</th><th>Phone</th><th>Service</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>';

    if (bookings && bookings.length > 0) {
        bookings.forEach(booking => {
            const dateObj = new Date(booking.date);
            const dateStr = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            html += `<tr>
                <td><strong>${booking.bookingNumber}</strong></td>
                <td>${booking.name}</td>
                <td>${booking.email}</td>
                <td>${booking.phone}</td>
                <td>${booking.service.charAt(0).toUpperCase() + booking.service.slice(1)}</td>
                <td>${dateStr}</td>
                <td><span class="status-badge status-${booking.status}">${booking.status}</span></td>
                <td><button class="btn btn-sm btn-primary" onclick="openBookingModal('${booking._id}')">View</button></td>
            </tr>`;
        });
    } else {
        html += '<tr><td colspan="8" style="text-align: center; padding: 30px;">No bookings found</td></tr>';
    }

    html += '</tbody></table>';
    document.getElementById('bookings-table-container').innerHTML = html;
}

function renderManageResults(query) {
    const container = document.getElementById('manage-content');
    if (!container) return;

    if (!query) {
        container.innerHTML = '<p style="color: #7f8c8d; padding: 20px 0;">Start typing a booking number or customer name to search.</p>';
        return;
    }

    const lowerQuery = query.toLowerCase();
    const matches = allBookings.filter(b =>
        (b.bookingNumber || '').toLowerCase().includes(lowerQuery) ||
        (b.name || '').toLowerCase().includes(lowerQuery)
    );

    if (matches.length === 0) {
        container.innerHTML = '<p style="color: #7f8c8d; padding: 20px 0;">No bookings match your search.</p>';
        return;
    }

    let html = '<table class="bookings-table"><thead><tr><th>Booking ID</th><th>Client</th><th>Email</th><th>Service</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    matches.forEach(booking => {
        const dateObj = new Date(booking.date);
        const dateStr = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        html += `<tr>
            <td><strong>${booking.bookingNumber}</strong></td>
            <td>${booking.name}</td>
            <td>${booking.email}</td>
            <td>${booking.service.charAt(0).toUpperCase() + booking.service.slice(1)}</td>
            <td>${dateStr}</td>
            <td><span class="status-badge status-${booking.status}">${booking.status}</span></td>
            <td><button class="btn btn-sm btn-primary" onclick="openBookingModal('${booking._id}')">View</button></td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

function applyFilters() {
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;
    const service = document.getElementById('filter-service').value;
    const status = document.getElementById('filter-status').value;

    let filtered = allBookings;

    if (startDate) {
        filtered = filtered.filter(b => new Date(b.date) >= new Date(startDate));
    }
    if (endDate) {
        filtered = filtered.filter(b => new Date(b.date) <= new Date(endDate));
    }
    if (service) {
        filtered = filtered.filter(b => b.service === service);
    }
    if (status) {
        filtered = filtered.filter(b => b.status === status);
    }

    displayBookingsTable(filtered);
}

async function openBookingModal(bookingId) {
    try {
        const booking = allBookings.find(b => b._id === bookingId);
        if (!booking) {
            showSuccess('Could not find that booking. Try refreshing the page.', true);
            return;
        }
        currentBookingId = bookingId;

        const dateObj = new Date(booking.date);
        const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        let html = `
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
                <h3 style="color: var(--primary); margin-bottom: 10px;">${booking.bookingNumber}</h3>
                <p><strong>Status:</strong> <span class="status-badge status-${booking.status}">${booking.status}</span></p>
            </div>
            <div style="margin-bottom: 15px;">
                <h4 style="margin-bottom: 10px;">Client Information</h4>
                <p><strong>Name:</strong> ${booking.name}</p>
                <p><strong>Email:</strong> ${booking.email}</p>
                <p><strong>Phone:</strong> ${booking.phone}</p>
                <p><strong>Country:</strong> ${booking.country}</p>
            </div>
            <div style="margin-bottom: 15px;">
                <h4 style="margin-bottom: 10px;">Appointment Details</h4>
                <p><strong>Service:</strong> ${booking.service.charAt(0).toUpperCase() + booking.service.slice(1)}</p>
                <p><strong>Date:</strong> ${dateStr}</p>
                <p><strong>Booked On:</strong> ${new Date(booking.bookedAt).toLocaleString()}</p>
            </div>
        `;

        document.getElementById('booking-details').innerHTML = html;
        document.getElementById('booking-modal').classList.add('show');
    } catch (error) {
        console.error('Error opening booking:', error);
    }
}

function closeBookingModal() {
    document.getElementById('booking-modal').classList.remove('show');
    currentBookingId = null;
}

async function confirmBooking() {
    if (!currentBookingId) return;

    try {
        const response = await fetch('/api/admin/bookings/' + currentBookingId + '/confirm', {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken'),
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (response.ok && data.success) {
            showSuccess('Booking confirmed successfully!');
            closeBookingModal();
            loadDashboardData();
            loadAllBookings();
        } else {
            showSuccess(data.message || 'Error confirming booking!', true);
        }
    } catch (error) {
        console.error('Error confirming booking:', error);
        showSuccess('Error confirming booking!', true);
    }
}

async function cancelBooking() {
    if (!currentBookingId) return;
    if (!confirm('Are you sure you want to cancel this booking?')) return;

    try {
        const response = await fetch('/api/admin/bookings/' + currentBookingId + '/cancel', {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken'),
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (response.ok && data.success) {
            showSuccess('Booking cancelled successfully!');
            closeBookingModal();
            loadDashboardData();
            loadAllBookings();
        } else {
            showSuccess(data.message || 'Error cancelling booking!', true);
        }
    } catch (error) {
        console.error('Error cancelling booking:', error);
        showSuccess('Error cancelling booking!', true);
    }
}

function sendMessage() {
    document.getElementById('message-modal').classList.add('show');
}

function closeMessageModal() {
    document.getElementById('message-modal').classList.remove('show');
    document.getElementById('message-text').value = '';
}

async function submitMessage() {
    const message = document.getElementById('message-text').value;
    if (!message || !currentBookingId) return;

    try {
        const response = await fetch('/api/admin/bookings/' + currentBookingId + '/message', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });

        const data = await response.json();
        if (response.ok && data.success) {
            showSuccess('Message sent successfully!');
            closeMessageModal();
            closeBookingModal();
        } else {
            showSuccess(data.message || 'Error sending message!', true);
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showSuccess('Error sending message!', true);
    }
}

function exportBookings(format) {
    if (format === 'csv') {
        exportToCSV();
    } else if (format === 'pdf') {
        exportToPDF();
    }
}

function exportToCSV() {
    let csv = 'Booking ID,Client Name,Email,Phone,Country,Service,Date,Status\n';
    allBookings.forEach(booking => {
        const dateStr = new Date(booking.date).toLocaleDateString();
        csv += `"${booking.bookingNumber}","${booking.name}","${booking.email}","${booking.phone}","${booking.country}","${booking.service}","${dateStr}","${booking.status}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bookings.csv';
    a.click();
}

function exportToPDF() {
    alert('PDF export requires a PDF library. For now, please use CSV export or contact support.');
}

async function loadAnalytics() {
    try {
        const response = await fetch('/api/admin/analytics', {
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken')
            }
        });
        const data = await response.json();

        if (data.success) {
            // Update service breakdown
            const services = data.serviceBreakdown || {};
            document.getElementById('bridal-count').textContent = services.bridal || 0;
            document.getElementById('party-count').textContent = services.party || 0;
            document.getElementById('casual-count').textContent = services.casual || 0;

            // Most popular service
            let maxService = 'bridal';
            let maxCount = services.bridal || 0;
            if ((services.party || 0) > maxCount) {
                maxService = 'party';
                maxCount = services.party;
            }
            if ((services.casual || 0) > maxCount) {
                maxService = 'casual';
                maxCount = services.casual;
            }
            document.getElementById('popular-service').textContent = maxService.charAt(0).toUpperCase() + maxService.slice(1);
            document.getElementById('popular-service-count').textContent = maxCount + ' bookings';

            // Peak booking day (backend already computes this; it was
            // previously fetched but never rendered)
            document.getElementById('peak-day').textContent = data.peakDay || '-';
            document.getElementById('peak-day-count').textContent = (data.peakDayCount || 0) + ' bookings';

            // No rating data is collected anywhere in the system yet, so
            // show this honestly rather than a fake number.
            document.getElementById('avg-rating').textContent = 'N/A';
            document.querySelector('#avg-rating').parentElement.querySelector('.stat-change').textContent = 'Not yet tracked';
        }
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

async function loadAvailability() {
    try {
        const response = await fetch('/api/admin/availability', {
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken')
            }
        });
        const data = await response.json();

        if (data.success && data.availability) {
            const a = data.availability;
            document.getElementById('weekday-start').value = a.weekdayStart;
            document.getElementById('weekday-end').value = a.weekdayEnd;
            document.getElementById('weekend-start').value = a.weekendStart;
            document.getElementById('weekend-end').value = a.weekendEnd;
            document.getElementById('lead-time').value = a.leadTimeDays;
        }
    } catch (error) {
        console.error('Error loading availability:', error);
    }
}

async function saveAvailability() {
    try {
        const weekdayStart = document.getElementById('weekday-start').value;
        const weekdayEnd = document.getElementById('weekday-end').value;
        const weekendStart = document.getElementById('weekend-start').value;
        const weekendEnd = document.getElementById('weekend-end').value;
        const leadTimeDays = parseInt(document.getElementById('lead-time').value, 10);

        const response = await fetch('/api/admin/availability', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken')
            },
            body: JSON.stringify({ weekdayStart, weekdayEnd, weekendStart, weekendEnd, leadTimeDays })
        });

        const data = await response.json();
        if (response.ok && data.success) {
            showSuccess('✅ Availability updated successfully!');
        } else {
            showSuccess(data.message || 'Error saving availability!', true);
        }
    } catch (error) {
        console.error('Error saving availability:', error);
        showSuccess('Error saving availability!', true);
    }
}

async function loadPricing() {
    try {
        document.getElementById('pricing-loading').style.display = 'block';
        document.getElementById('pricing-content').style.display = 'none';

        const response = await fetch('/api/admin/pricing', {
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('adminToken')
            }
        });

        const data = await response.json();

        if (data.success && data.pricing) {
            data.pricing.forEach(service => {
                const serviceName = service.service || service.name;
                if (document.getElementById(`price-${serviceName}`)) {
                    document.getElementById(`price-${serviceName}`).value = service.price || service.minPrice || '';
                    if (document.getElementById(`desc-${serviceName}`)) {
                        document.getElementById(`desc-${serviceName}`).value = service.description || '';
                    }
                    if (document.getElementById(`duration-${serviceName}`)) {
                        document.getElementById(`duration-${serviceName}`).value = service.duration || '';
                    }
                    if (document.getElementById(`${serviceName}-desc`)) {
                        document.getElementById(`${serviceName}-desc`).textContent = service.description || '';
                    }
                }
            });
            bookingPrices = data.pricing.reduce((acc, s) => {
                const serviceName = s.service || s.name;
                acc[serviceName] = s.price || s.minPrice || 0;
                return acc;
            }, {});
        }
    } catch (error) {
        console.error('Error loading pricing:', error);
    } finally {
        document.getElementById('pricing-loading').style.display = 'none';
        document.getElementById('pricing-content').style.display = 'block';
    }
}

async function savePricing() {
    try {
        const services = ['bridal', 'party', 'casual'];
        const adminToken = localStorage.getItem('adminToken');

        for (const service of services) {
            const price = parseInt(document.getElementById(`price-${service}`).value);
            const description = document.getElementById(`desc-${service}`).value;
            const duration = document.getElementById(`duration-${service}`).value;

            if (isNaN(price) || price < 0) {
                showSuccess(`Invalid price for ${service}!`, true);
                return;
            }

            const response = await fetch(`/api/admin/pricing/${service}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + adminToken
                },
                body: JSON.stringify({ price, description, duration })
            });

            const data = await response.json();
            if (!data.success) {
                showSuccess(`Error updating ${service}: ${data.message}`, true);
                return;
            }
        }

        // Update local prices
        bookingPrices = {
            bridal: parseInt(document.getElementById('price-bridal').value),
            party: parseInt(document.getElementById('price-party').value),
            casual: parseInt(document.getElementById('price-casual').value)
        };

        showSuccess('✅ All pricing updated successfully in database!');
    } catch (error) {
        console.error('Error saving pricing:', error);
        showSuccess('Error saving pricing!', true);
    }
}

async function saveEmailTemplate() {
    try {
        const subject = document.getElementById('confirm-subject').value;
        const body = document.getElementById('confirm-body').value;
        const adminToken = localStorage.getItem('adminToken');

        if (!subject || !subject.trim()) {
            showSuccess('Email subject cannot be empty!', true);
            return;
        }

        if (!body || !body.trim()) {
            showSuccess('Email body cannot be empty!', true);
            return;
        }

        const response = await fetch('/api/admin/email-templates/confirmation', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + adminToken
            },
            body: JSON.stringify({ subject, body })
        });

        const data = await response.json();
        if (!data.success) {
            showSuccess(`Error saving email template: ${data.message}`, true);
            return;
        }

        showSuccess('✅ Email template saved successfully to database!');
    } catch (error) {
        console.error('Error saving email template:', error);
        showSuccess('Error saving email template!', true);
    }
}

async function loadEmailTemplate() {
    try {
        // There is no GET /api/admin/email-templates/:type route (only the
        // bulk /api/admin/email-templates and this public single-type
        // lookup exist) - using the admin URL here always 404'd silently,
        // leaving the form stuck on its hardcoded HTML defaults.
        const response = await fetch('/api/email-templates/confirmation');

        const data = await response.json();
        if (data.success && data.template) {
            document.getElementById('confirm-subject').value = data.template.subject;
            document.getElementById('confirm-body').value = data.template.body;
        }
    } catch (error) {
        console.error('Error loading email template:', error);
    }
}

function showSuccess(message, isError = false) {
    const successEl = document.getElementById('success-message');
    document.getElementById('success-text').textContent = message;
    successEl.classList.add('show');
    if (isError) {
        successEl.style.backgroundColor = '#e74c3c';
        successEl.style.color = 'white';
    } else {
        successEl.style.backgroundColor = '#27ae60';
        successEl.style.color = 'white';
    }
    setTimeout(() => successEl.classList.remove('show'), 4000);
}

function adminLogout() {
    localStorage.removeItem('adminToken');
    window.location.href = '/admin-login.html';
}
