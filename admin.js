// Global variables
let allBookings = [];
let currentBookingId = null;
let bookingPrices = {
    bridal: 25000,
    party: 15000,
    casual: 10000
};

// Escape user-supplied text before inserting into innerHTML, to prevent stored XSS
// via free-text booking fields (name, country, etc.) that a public visitor controls.
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Admin authentication check
window.addEventListener('load', () => {
    const adminToken = localStorage.getItem('adminToken');
    if (!adminToken) {
        window.location.href = '/admin-login.html';
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

    const saveAvailabilityBtn = Array.from(document.querySelectorAll('button')).find(btn =>
                                 btn.textContent.includes('Save Availability'));
    if (saveAvailabilityBtn) {
        saveAvailabilityBtn.addEventListener('click', () => {
            showSuccess('Availability saved successfully!');
        });
        console.log('✅ Save Availability button listener attached');
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
                    <td>${escapeHtml(apt.name)}</td>
                    <td>${apt.service.charAt(0).toUpperCase() + apt.service.slice(1)}</td>
                    <td>${escapeHtml(apt.phone)}</td>
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
                    <td><strong>${escapeHtml(booking.bookingNumber)}</strong></td>
                    <td>${escapeHtml(booking.name)}</td>
                    <td>${escapeHtml(booking.email)}</td>
                    <td>${booking.service.charAt(0).toUpperCase() + booking.service.slice(1)}</td>
                    <td>${dateStr}</td>
                    <td><button class="btn btn-sm btn-primary" onclick="openBookingModal('${booking._id || booking.id}')">View</button></td>
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
                <td><strong>${escapeHtml(booking.bookingNumber)}</strong></td>
                <td>${escapeHtml(booking.name)}</td>
                <td>${escapeHtml(booking.email)}</td>
                <td>${escapeHtml(booking.phone)}</td>
                <td>${booking.service.charAt(0).toUpperCase() + booking.service.slice(1)}</td>
                <td>${dateStr}</td>
                <td><span class="status-badge status-${booking.status}">${booking.status}</span></td>
                <td><button class="btn btn-sm btn-primary" onclick="openBookingModal('${booking._id || booking.id}')">View</button></td>
            </tr>`;
        });
    } else {
        html += '<tr><td colspan="8" style="text-align: center; padding: 30px;">No bookings found</td></tr>';
    }

    html += '</tbody></table>';
    document.getElementById('bookings-table-container').innerHTML = html;
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
        const booking = allBookings.find(b => b._id === bookingId || String(b.id) === bookingId);
        currentBookingId = bookingId;

        const dateObj = new Date(booking.date);
        const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        let html = `
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
                <h3 style="color: var(--primary); margin-bottom: 10px;">${escapeHtml(booking.bookingNumber)}</h3>
                <p><strong>Status:</strong> <span class="status-badge status-${booking.status}">${booking.status}</span></p>
            </div>
            <div style="margin-bottom: 15px;">
                <h4 style="margin-bottom: 10px;">Client Information</h4>
                <p><strong>Name:</strong> ${escapeHtml(booking.name)}</p>
                <p><strong>Email:</strong> ${escapeHtml(booking.email)}</p>
                <p><strong>Phone:</strong> ${escapeHtml(booking.phone)}</p>
                <p><strong>Country:</strong> ${escapeHtml(booking.country)}</p>
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

        if (response.ok) {
            showSuccess('Booking confirmed successfully!');
            closeBookingModal();
            loadDashboardData();
            loadAllBookings();
        }
    } catch (error) {
        console.error('Error confirming booking:', error);
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

        if (response.ok) {
            showSuccess('Booking cancelled successfully!');
            closeBookingModal();
            loadDashboardData();
            loadAllBookings();
        }
    } catch (error) {
        console.error('Error cancelling booking:', error);
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

        if (response.ok) {
            showSuccess('Message sent successfully!');
            closeMessageModal();
            closeBookingModal();
        }
    } catch (error) {
        console.error('Error sending message:', error);
    }
}

function exportBookings(format) {
    if (format === 'csv') {
        exportToCSV();
    } else if (format === 'pdf') {
        exportToPDF();
    }
}

// Neutralize CSV/formula injection: a field starting with =, +, -, @, tab or CR is
// interpreted as a formula by Excel/Sheets when the exported file is opened. Prefixing
// with a single quote forces text interpretation. Embedded quotes are escaped per the
// CSV spec so the prefix (and the value itself) can't break the surrounding quoting.
function sanitizeCsvField(value) {
    let str = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
    }
    return str.replace(/"/g, '""');
}

function exportToCSV() {
    let csv = 'Booking ID,Client Name,Email,Phone,Country,Service,Date,Status\n';
    allBookings.forEach(booking => {
        const dateStr = new Date(booking.date).toLocaleDateString();
        csv += `"${sanitizeCsvField(booking.bookingNumber)}","${sanitizeCsvField(booking.name)}","${sanitizeCsvField(booking.email)}","${sanitizeCsvField(booking.phone)}","${sanitizeCsvField(booking.country)}","${sanitizeCsvField(booking.service)}","${sanitizeCsvField(dateStr)}","${sanitizeCsvField(booking.status)}"\n`;
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
        }
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

function saveAvailability() {
    showSuccess('Availability updated successfully!');
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
                if (document.getElementById(`minprice-${serviceName}`)) {
                    document.getElementById(`minprice-${serviceName}`).value = service.minPrice ?? '';
                    document.getElementById(`maxprice-${serviceName}`).value = service.maxPrice ?? '';
                    if (document.getElementById(`desc-${serviceName}`)) {
                        document.getElementById(`desc-${serviceName}`).value = service.description || '';
                    }
                    if (document.getElementById(`${serviceName}-desc`)) {
                        document.getElementById(`${serviceName}-desc`).textContent = service.description || '';
                    }
                }
            });
            bookingPrices = data.pricing.reduce((acc, s) => {
                const serviceName = s.service || s.name;
                acc[serviceName] = { minPrice: s.minPrice, maxPrice: s.maxPrice };
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
            const minPrice = parseInt(document.getElementById(`minprice-${service}`).value);
            const maxPrice = parseInt(document.getElementById(`maxprice-${service}`).value);
            const description = document.getElementById(`desc-${service}`).value;

            if (isNaN(minPrice) || minPrice < 0 || isNaN(maxPrice) || maxPrice < 0) {
                showSuccess(`Invalid price for ${service}!`, true);
                return;
            }
            if (minPrice > maxPrice) {
                showSuccess(`Min price cannot exceed max price for ${service}!`, true);
                return;
            }

            const response = await fetch(`/api/admin/pricing/${service}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + adminToken
                },
                body: JSON.stringify({ minPrice, maxPrice, description })
            });

            const data = await response.json();
            if (!data.success) {
                showSuccess(`Error updating ${service}: ${data.message}`, true);
                return;
            }
        }

        // Update local prices
        bookingPrices = {
            bridal: { minPrice: parseInt(document.getElementById('minprice-bridal').value), maxPrice: parseInt(document.getElementById('maxprice-bridal').value) },
            party: { minPrice: parseInt(document.getElementById('minprice-party').value), maxPrice: parseInt(document.getElementById('maxprice-party').value) },
            casual: { minPrice: parseInt(document.getElementById('minprice-casual').value), maxPrice: parseInt(document.getElementById('maxprice-casual').value) }
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
        const adminToken = localStorage.getItem('adminToken');
        const response = await fetch('/api/admin/email-templates/confirmation', {
            headers: {
                'Authorization': 'Bearer ' + adminToken
            }
        });

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
