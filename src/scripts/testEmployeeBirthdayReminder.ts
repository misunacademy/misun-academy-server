/**
 * Test Employee Birthday Reminder
 * Ensure at least one employee has dateOfBirth exactly 10 days from today.
 */

import { connectDB } from '../config/database.js';
import { sendEmployeeBirthdayReminders } from '../utils/employeeBirthdayReminderScheduler.js';

const run = async () => {
    console.log('🚀 Running employee birthday reminder test...');
    await connectDB();
    await sendEmployeeBirthdayReminders();
    console.log('✅ Reminder check completed. If a matching birthday exists, the email was queued.');
};

run().catch((error) => {
    console.error('❌ Birthday reminder test failed:', error);
});
