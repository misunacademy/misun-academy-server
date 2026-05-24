/**
 * Employee Birthday Reminder Scheduler
 * Sends a reminder email exactly 10 days before an employee birthday.
 */

import cron from 'node-cron';
import type { Types } from 'mongoose';
import { EmployeeProfileModel } from '../modules/Employee/employee.model.js';
import { logger } from '../config/logger.js';
import { sendEmployeeBirthdayReminderEmail } from '../services/misunAcademyEmails.js';

const REMINDER_DAYS = 10;
// 'misunacademybd@gmail.com'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL!;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CRON_SCHEDULE = '0 9 * * *';
const CRON_TIMEZONE = 'Asia/Dhaka';

interface PopulatedUser {
    _id: Types.ObjectId;
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
}

interface EmployeeProfileLean {
    _id: Types.ObjectId;
    userId?: PopulatedUser | Types.ObjectId | null;
    dateOfBirth?: Date | null;
    designation?: string | null;
    birthdayReminderSentForYear?: number | null;
}

const normalizeDate = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const isLeapYear = (year: number) => {
    if (year % 400 === 0) return true;
    if (year % 100 === 0) return false;
    return year % 4 === 0;
};

const getSafeDate = (year: number, month: number, day: number) => {
    if (month === 1 && day === 29 && !isLeapYear(year)) {
        return new Date(year, 1, 28);
    }
    return new Date(year, month, day);
};

const getNextBirthday = (dob: Date, fromDate: Date) => {
    const month = dob.getMonth();
    const day = dob.getDate();
    const year = fromDate.getFullYear();

    let candidate = getSafeDate(year, month, day);
    if (candidate < fromDate) {
        candidate = getSafeDate(year + 1, month, day);
    }
    return candidate;
};

const isSameDay = (a: Date, b: Date) => (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
);

export const sendEmployeeBirthdayReminders = async () => {
    try {
        const today = normalizeDate(new Date());
        const targetDate = new Date(today.getTime() + REMINDER_DAYS * MS_PER_DAY);

        const profiles = await EmployeeProfileModel.find({
            dateOfBirth: { $ne: null },
        }).populate('userId', 'name email phone address').lean<EmployeeProfileLean[]>();

        if (!profiles.length) {
            logger.info('No employee profiles with date of birth found');
            return;
        }

        let remindersSent = 0;

        for (const profile of profiles) {
            if (!profile.dateOfBirth || !profile.userId) continue;

            const dob = new Date(profile.dateOfBirth as Date);
            if (Number.isNaN(dob.getTime())) continue;

            const nextBirthday = getNextBirthday(dob, today);
            if (!isSameDay(nextBirthday, targetDate)) continue;

            const nextBirthdayYear = nextBirthday.getFullYear();
            if (profile.birthdayReminderSentForYear === nextBirthdayYear) continue;

            const user = profile.userId as PopulatedUser | undefined;
            if (!user?.email) continue;

            const employeeName = user.name || 'Employee';
            const employeeEmail = user.email || 'Not provided';
            const employeePhone = user.phone || 'Not provided';
            const employeeAddress = user.address || 'Not provided';
            const designation = profile.designation || 'Not provided';
            const ageTurning = nextBirthday.getFullYear() - dob.getFullYear();

            await sendEmployeeBirthdayReminderEmail({
                to: ADMIN_EMAIL,
                employeeId: String(user._id),
                employeeName,
                employeeEmail,
                employeePhone,
                employeeAddress,
                designation,
                dateOfBirth: dob,
                upcomingBirthday: nextBirthday,
                daysUntil: REMINDER_DAYS,
                ageTurning,
            });

            await EmployeeProfileModel.updateOne(
                { _id: profile._id },
                {
                    $set: {
                        birthdayReminderSentForYear: nextBirthdayYear,
                        birthdayReminderSentAt: new Date(),
                    },
                }
            );

            remindersSent += 1;
        }

        logger.info(`Employee birthday reminder check completed. Emails queued: ${remindersSent}`);
    } catch (error: unknown) {
        logger.error(`Error sending employee birthday reminders: ${(error as Error).message}`);
    }
};

/**
 * Schedule employee birthday reminders (runs daily at 9 AM)
 */
export const scheduleEmployeeBirthdayReminders = () => {
    sendEmployeeBirthdayReminders().catch(error =>
        logger.error('Initial employee birthday reminder check failed:', error)
    );

    cron.schedule(CRON_SCHEDULE, () => {
        sendEmployeeBirthdayReminders().catch(error =>
            logger.error('Scheduled employee birthday reminder check failed:', error)
        );
    }, { timezone: CRON_TIMEZONE });

    logger.info(`Employee birthday reminder cron scheduled: ${CRON_SCHEDULE} (${CRON_TIMEZONE})`);
};
