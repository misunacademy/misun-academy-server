import env from '../config/env.js';
import { SettingsService } from '../modules/Settings/settings.service.js';
import { queueEmail } from './emailService.js';

const getDisplayCurrency = (currency: string, paymentMethod?: string) => {
    return paymentMethod === 'PhonePay' ? 'INR' : currency;
};

const resolveGroupLinks = async (courseName: string) => {
    const groupLinks = await SettingsService.getSocialGroupLinks();
    const isEnglishCourse = /english/i.test(courseName);

    return isEnglishCourse
        ? {
            facebookGroupLink: groupLinks.epFacebookGroupLink,
            whatsappGroupLink: groupLinks.epWhatsappGroupLink,
        }
        : {
            facebookGroupLink: groupLinks.maFacebookGroupLink,
            whatsappGroupLink: groupLinks.maWhatsappGroupLink,
        };
};


// ============================================================================
// 4. TEMPLATE ENGINE
// ============================================================================

const getEmailTemplate = (content: string, headerColor: string = "#2563eb") => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Esun Point</title>
    <style>
        body { margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        .wrapper { max-width: 600px; margin: 0 auto; background: #ffffff; overflow: hidden; }
        .header { background: ${headerColor}; padding: 40px 20px; text-align: center; color: white; }
        .content { padding: 40px 30px; color: #374151; line-height: 1.6; }
        .highlight-box { background: #f9fafb; border-left: 4px solid ${headerColor}; padding: 16px; margin: 20px 0; border-radius: 4px; }
        .button { display: inline-block; padding: 12px 28px; background: ${headerColor}; color: white !important; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
        .footer { background: #1f2937; color: #9ca3af; padding: 24px; text-align: center; font-size: 13px; }
        .footer a { color: #d1d5db; text-decoration: none; }
        .footer a:hover { color: #ffffff; }
        .footer-social { margin: 14px 0; }
        .footer-social a { display: inline-block; width: 36px; height: 36px; line-height: 36px; margin: 0 5px 5px 5px; font-size: 14px; font-family: Arial, Helvetica, sans-serif; font-weight: 700; text-align: center; border: none; border-radius: 50%; color: #ffffff !important; text-decoration: none; transition: opacity 0.2s ease; }
        .footer-social a:hover { opacity: 0.85; }
        .footer-social .icon-facebook { background: #1877F2; }
        .footer-social .icon-twitter { background: #000000; }
        .footer-social .icon-youtube { background: #CD201F; font-size: 15px; line-height: 36px; }
        .footer-social .icon-linkedin { background: #0A66C2; font-size: 13px; letter-spacing: -0.3px; }
        .footer-social .icon-instagram { background: linear-gradient(135deg, #fd1d1d 0%, #833ab4 25%, #c13584 50%, #e1306c 75%, #fd1d1d 100%); font-size: 13px; }
        .badge { background: #e5e7eb; padding: 2px 8px; border-radius: 12px; font-size: 12px; color: #374151; }
        a { color: ${headerColor}; text-decoration: none; }
    </style>
</head>
<body>
    <div class="wrapper">
        ${content}
        <div class="footer">
            <p>Esun Point | Learn. Grow. Succeed.</p>
            <p><a href="mailto:misunacademybd@gmail.com">misunacademybd@gmail.com</a></p>
            <div class="footer-social">
                <a class="icon-facebook" href="${env.EP_EMAIL_SOCIAL_FACEBOOK}" target="_blank" rel="noopener noreferrer" title="Facebook" aria-label="Facebook">f</a>
                <a class="icon-youtube" href="${env.EP_EMAIL_SOCIAL_YOUTUBE}" target="_blank" rel="noopener noreferrer" title="YouTube" aria-label="YouTube">▶️</a>
            </div>
            <p>© ${new Date().getFullYear()} Esun Point. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`;

// ============================================================================
// 5. DOMAIN SPECIFIC EMAILS
// ============================================================================


// --- PAYMENTS & ENROLLMENT ---

export const sendPaymentSuccessEmail = async (
    email: string,
    name: string,
    amount: number,
    currency: string,
    courseName: string,
    transactionId: string,
    paymentMethod?: string,
) => {
    const displayCurrency = getDisplayCurrency(currency, paymentMethod);
    const html = getEmailTemplate(`
        <div class="header" style="background: #2563eb;">
            <h1>Payment Successful!</h1>
        </div>
        <div class="content">
            <p>Dear <strong>${name}</strong>,</p>
            <p>We have received your payment for <strong>${courseName}</strong>.</p>
            
            <div class="highlight-box">
                <p><strong>Amount:</strong> ${amount} ${displayCurrency}</p>
                <p><strong>Transaction ID:</strong> ${transactionId}</p>
                <p><strong>Status:</strong> <span style="color:#2563eb; font-weight:bold;">PAID</span></p>
            </div>
            
            <p>You can now access your dashboard and start learning!</p>
            <div style="text-align: center;">
                <a href="${env.MA_FRONTEND_URL}/my-classes" class="button">Go to Dashboard</a>
            </div>
        </div>
    `, "#2563eb");

    await queueEmail(email, 'Payment Receipt', html, { eventType: 'payment_success', eventId: transactionId });
};

export const sendPaymentReviewEmail = async (student: any, courseName: string, transactionId: string) => {
    const html = getEmailTemplate(`
        <div class="header" style="background: #f59e0b;">
            <h1>Payment Under Review</h1>
        </div>
        <div class="content">
            <p>Dear ${student.name},</p>
            <p>Your payment for <strong>${courseName}</strong> is being verified.</p>
            <div class="highlight-box" style="border-color: #f59e0b;">
                <p><strong>Transaction ID:</strong> ${transactionId}</p>
                <p>Please allow 24 hours for manual verification.</p>
            </div>
        </div>
    `, "#f59e0b");

    await queueEmail(student.email, 'Payment Under Review', html, { eventType: 'payment_review', eventId: transactionId });
};

export const sendPaymentFailedEmail = async (student: any, courseName: string, reason: string) => {
    const html = getEmailTemplate(`
        <div class="header" style="background: #ef4444;">
            <h1>Payment Failed</h1>
        </div>
        <div class="content">
            <p>Dear ${student.name},</p>
            <p>Your payment for <strong>${courseName}</strong> could not be completed.</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>Please try again or contact support.</p>
        </div>
    `, "#ef4444");

    await queueEmail(student.email, 'Payment Failed', html, { priority: 'high' });
};


// --- ACADEMIC ---

export const sendBatchStartReminderEmail = async (studentEmail: string, studentName: string, batchName: string, startDate: string) => {
    const html = getEmailTemplate(`
        <div class="header" style="background: #3b82f6;">
            <h1>Class Starting Soon!</h1>
        </div>
        <div class="content">
            <p>Hi ${studentName},</p>
            <p>Get ready! Your batch <strong>${batchName}</strong> is starting on <strong>${startDate}</strong>.</p>
            <p>Make sure you have joined the WhatsApp/Facebook groups.</p>
            <div style="text-align: center;">
                <a href="${env.MA_FRONTEND_URL}/classroom" class="button" style="background: #3b82f6;">Enter Classroom</a>
            </div>
        </div>
    `, "#3b82f6");

    await queueEmail(studentEmail, `Reminder: ${batchName} Starts Soon`, html);
};



export const sendEnrollmentConfirmationEmail = async (
    user: any,
    courseName: string,
    enrollmentId: string,
    amount: number,
    paymentMethod?: string,
) => {
    const paymentAmount = amount;
    const displayCurrency = getDisplayCurrency('BDT', paymentMethod);
    const { facebookGroupLink, whatsappGroupLink } = await resolveGroupLinks(courseName);

    const html = getEmailTemplate(`
        <div class="header" style="background: #2563eb;">
            <h1>Enrollment Confirmed!</h1>
        </div>
        <div class="content">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0; font-family: Helvetica, Arial, sans-serif;">
        <tr>
            <td align="center">
                
                <table role="presentation" class="container" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin: 0 auto;">
                    
               

                    <tr>
                        <td class="content-padding" style="padding: 40px 30px 20px 30px; color: #333333; line-height: 1.6;">
                            
                            <p style="font-size: 16px; margin-bottom: 20px; margin-top: 0;">
                                <strong>Dear ${user.name},</strong>
                            </p>
                            <p style="font-size: 16px; margin-bottom: 20px;">
                                Congratulations! Your payment has been successfully processed, and you are officially enrolled in <strong>${courseName}</strong>.
                            </p>
                            <p style="font-size: 16px; margin-bottom: 20px;">
                                We are thrilled to welcome you to the Esun Point learning community. This comprehensive course is designed to equip you with industry-standard communication skill.
                            </p>
                            
                            <div style="background-color: #eef7ff; padding: 20px; border-radius: 5px; border-left: 5px solid #0084ff; margin: 30px 0;">
                                <h3 style="margin-top: 0; color: #0084ff;">🚀 Your Next Steps</h3>
                                <p style="margin-bottom: 20px;">To get the most out of this course, please join our private community groups immediately for updates and resources.</p>
                                
                                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                                    <tr>
                                        <td>
                                            <a href="${facebookGroupLink}" style="display: inline-block; padding: 12px 24px; background-color: #3b5998; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: bold; margin-right: 10px; margin-bottom: 10px;">Join Facebook Group</a>
                                            <a href="${whatsappGroupLink}" style="display: inline-block; padding: 12px 24px; background-color: #25D366; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: bold;">Join WhatsApp Group</a>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9f9f9; border-radius: 5px; margin-top: 20px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin-top: 0; margin-bottom: 10px; font-size: 18px; color: #333333;">Payment & Enrollment Receipt</h3>
                                        <p style="margin: 5px 0; font-size: 14px;"><strong>Student Name:</strong> ${user.name}</p>
                                        <p style="margin: 5px 0; font-size: 14px;"><strong>Enrollment ID:</strong> ${enrollmentId}</p>
                                        <p style="margin: 5px 0; font-size: 14px;"><strong>Email:</strong> ${user.email}</p>
                                        <p style="margin: 5px 0; font-size: 14px;"><strong>Amount:</strong> ${paymentAmount} ${displayCurrency}</p>
                                        <p style="margin: 5px 0; font-size: 14px; color: green;"><strong>Status:</strong> Success ✅</p>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 0 40px 40px 40px; text-align: center;">
                            <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;">
                            <p style="margin-bottom: 20px; color: #666;">You can now access your dashboard and start learning!</p>
                            <a href="${env.MA_FRONTEND_URL}/my-classes" style="display: inline-block; padding: 14px 30px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px;">Go to Dashboard</a>
                        </td>
                    </tr>
                    

                </table>
            </td>
        </tr>
    </table>
        </div>
    `, "#2563eb");

    await queueEmail(user.email, 'Enrollment Confirmation', html, { eventType: 'enrollment_confirm', eventId: enrollmentId });
};


export const sendWaitingPaymentVerificationEmail = async (student: any, courseName: string, transactionId: string) => {
    const html = getEmailTemplate(`
        <div class="header" style="background: #f59e0b;">
            <h1>Payment Verification Pending</h1>
        </div>
        <div class="content">
            <p>Dear ${student.name},</p>
            <p>Your payment for <strong>${courseName}</strong> is pending verification.</p>
            <div class="highlight-box" style="border-color: #f59e0b;">
                <p><strong>Transaction ID:</strong> ${transactionId}</p>
                <p>We will notify you once the verification is complete.</p>
            </div>
        </div>
    `, "#f59e0b");
    await queueEmail(student.email, 'Payment Verification Pending', html, { eventType: 'payment_verification', eventId: transactionId });
};

// --- ADMIN BULK EMAILS ---

/**
 * Send progress reminder to running batch students below threshold
 */
export const sendRunningBatchProgressReminderEmail = async (
    email: string,
    name: string,
    courseName: string,
    batchName: string,
    progress: number,
) => {
    const html = getEmailTemplate(`
        <div class="header" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
            <h1>তুমি ক্লাস রেকর্ডগুলো ঠিকমতো দেখছো না, তুমি কি কোনো প্রবলেমে আছো?</h1>
        </div>

        <div class="content">
            <p>প্রিয় শিক্ষার্থী,</p>

            <p>
                আমাদের <strong>${batchName}</strong> ব্যাচের অনেকগুলো ক্লাস ইতোমধ্যে সম্পন্ন হয়েছে।
                আমরা লক্ষ্য করলাম, তুমি বেশ কিছু ক্লাস রেকর্ড দেখা মিস করেছো এবং এখনো অনেক কন্টেন্ট তোমার দেখা বাকি রয়েছে।
            </p>

            <p>
                তুমি কি কোনো সমস্যার মধ্যে আছো? যদি পড়াশোনা, সময় ম্যানেজমেন্ট বা অন্য যেকোনো বিষয়ে
                কোনো জটিলতা ফেস করে থাকো, তাহলে নির্দ্বিধায় আমাদের জানাতে পারো।
                আমরা সবসময় তোমাকে সাহায্য করতে প্রস্তুত।
            </p>

            <p>
                এখন থেকেই অল্প অল্প করে ধাপে ধাপে ক্লাসগুলো দেখা শুরু করো।
                নিয়মিত প্র্যাকটিস করলে দেখবে খুব দ্রুতই তুমি আগের অবস্থানে ফিরে আসতে পারছো।
            </p>

            <div class="highlight-box" style="border-color: #f59e0b;">
                <p><strong>স্টুডেন্ট:</strong> ${name || 'Student'}</p>
                <p><strong>কোর্স:</strong> ${courseName}</p>
                <p><strong>ব্যাচ:</strong> ${batchName}</p>
                <p><strong>বর্তমান প্রগতি:</strong> ${progress}%</p>
            </div>

            <p>
                আমাদের এই কোর্স সম্পন্ন করে অনেক শিক্ষার্থী ইতোমধ্যে চাকরি পেয়েছে,
                কেউ ফ্রিল্যান্সিং শুরু করেছে, আবার কেউ নিজের ক্যারিয়ারে দারুণ অগ্রগতি করেছে।
                তুমিও পারবে, শুধু ধারাবাহিকতা বজায় রাখা প্রয়োজন।
            </p>

            <p>
                তাই আজই নতুন উদ্যমে আবার শুরু করো।
                যেকোনো প্রয়োজনে আমাদের সাথে যোগাযোগ করতে একদম দ্বিধা করবে না।
            </p>

            <p>তোমার জন্য অনেক শুভকামনা। ❤️</p>
        </div>
    `, "#f59e0b");

    await queueEmail(
        email,
        'তুমি ক্লাস রেকর্ডগুলো ঠিকমতো দেখছো না, তুমি কি কোনো প্রবলেমে আছো?',
        html,
        {
            priority: 'normal',
            eventType: 'batch_progress_reminder',
        }
    );
};

/**
 * Send completion reminder to students in completed batches with incomplete progress
 */
export const sendCompletedBatchIncompleteReminderEmail = async (
    email: string,
    name: string,
    courseName: string,
    batchName: string,
    progress: number,
) => {
    const html = getEmailTemplate(`
        <div class="header" style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);">
            <h1>তোমার কোর্স এখনো অসম্পূর্ণ — আমরা তোমাকে সাহায্য করতে চাই</h1>
        </div>

        <div class="content">
            <p>প্রিয় শিক্ষার্থী,</p>

            <p>
                <strong>${batchName}</strong> ব্যাচটি ইতোমধ্যে শেষ হয়েছে,
                কিন্তু আমরা লক্ষ্য করেছি যে তোমার কোর্সটি এখনো সম্পূর্ণ হয়নি।
                হয়তো কোনো ব্যস্ততা বা সমস্যার কারণে তোমার শেখার যাত্রায় কিছুটা বিরতি এসেছে।
            </p>

            <p>
                কোর্স নিয়ে তোমার যদি কোনো রকম সমস্যা, দ্বিধা বা বাধা থাকে,
                তাহলে প্লিজ আমাদের সাথে শেয়ার করো।
                আমরা সবসময় তোমার পাশে থেকে তোমাকে গাইড করতে চাই,
                যেন তুমি সফলভাবে কোর্সটি সম্পন্ন করতে পারো।
            </p>

            <div class="highlight-box" style="border-color: #3b82f6;">
                <p><strong>স্টুডেন্ট:</strong> ${name || 'Student'}</p>
                <p><strong>কোর্স:</strong> ${courseName}</p>
                <p><strong>ব্যাচ:</strong> ${batchName}</p>
                <p><strong>বর্তমান প্রগতি:</strong> ${progress}%</p>
            </div>

            <p>
                তোমার অনেক সহপাঠী ইতোমধ্যে অনেক দূর এগিয়ে গেছে।
                কেউ লোকাল ক্লায়েন্টের কাজ করছে,
                কেউ মার্কেটপ্লেসে সফলভাবে কাজ করছে,
                আবার অনেকে চাকরিও পেয়েছে।
                হয়তো কোনো কারণে তোমার কিছুটা গ্যাপ তৈরি হয়েছে,
                কিন্তু এখনো সময় আছে ঘুরে দাঁড়ানোর।
            </p>

            <p>
                তোমার সমস্যাগুলো আমাদের জানাও এবং আজ থেকেই আবার
                অল্প অল্প করে ক্লাস দেখা ও প্র্যাকটিস করা শুরু করো।
                প্রতিদিন সামান্য সময় দিলেও খুব দ্রুতই তুমি কোর্সটি সম্পন্ন করতে পারবে।
            </p>

            <p>
                আমরা বিশ্বাস করি, তুমি চাইলে অবশ্যই সফল হতে পারবে।
            </p>

            <p>তোমার জন্য অনেক শুভকামনা। ❤️</p>
        </div>
    `, "#3b82f6");

    await queueEmail(
        email,
        'তোমার কোর্স এখনো অসম্পূর্ণ — আমরা তোমাকে সাহায্য করতে চাই',
        html,
        {
            priority: 'normal',
            eventType: 'batch_incomplete_reminder',
        }
    );
};
