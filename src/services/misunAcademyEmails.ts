// ============================================================================
// 4. TEMPLATE ENGINE
// ============================================================================

import env from "../config/env.js";
import { SettingsService } from "../modules/Settings/settings.service.js";
import { queueEmail } from "./emailService.js";

const getDisplayCurrency = (currency: string, paymentMethod?: string) => {
  return paymentMethod === "PhonePay" ? "INR" : currency;
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

const getEmailTemplate = (content: string, headerColor: string = "#10b981") => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Misun Academy</title>
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
            <p>Misun Academy | Learn. Grow. Succeed.</p>
            <p><a href="mailto:misunacademybd@gmail.com">misunacademybd@gmail.com</a></p>
            <div class="footer-social">
                <a class="icon-facebook" href="${env.MA_EMAIL_SOCIAL_FACEBOOK}" target="_blank" rel="noopener noreferrer" title="Facebook" aria-label="Facebook">f</a>
                <a class="icon-youtube" href="${env.MA_EMAIL_SOCIAL_YOUTUBE || "https://www.youtube.com/@misunacademybd"}" target="_blank" rel="noopener noreferrer" title="YouTube" aria-label="YouTube">▶️</a>
                <a class="icon-linkedin" href="${env.MA_EMAIL_SOCIAL_LINKEDIN || "https://www.linkedin.com/company/misun-academy"}" target="_blank" rel="noopener noreferrer" title="LinkedIn" aria-label="LinkedIn">in</a>
            </div>
            <p>© ${new Date().getFullYear()} Misun Academy. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`;

// ============================================================================
// 5. DOMAIN SPECIFIC EMAILS
// ============================================================================

// --- AUTHENTICATION ---

export const sendVerificationEmail = async (
  email: string,
  name: string,
  token: string,
) => {
  const link = `${env.MA_FRONTEND_URL}/verify-email?token=${token}`;
  const html = getEmailTemplate(
    `
        <div class="header" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
            <h1>Verify Your Email</h1>
        </div>
        <div class="content">
            <p>Hi <strong>${name}</strong>,</p>
            <p>Welcome to Misun Academy! Please verify your email to activate your account.</p>
            <div style="text-align: center;">
                <a href="${link}" class="button" style="background: #10b981;">Verify Now</a>
            </div>
            <p style="font-size: 12px;">Link expires in 24 hours.</p>
        </div>
    `,
    "#10b981",
  );

  await queueEmail(email, "Verify Your Email", html, {
    priority: "high",
    eventType: "verify_email",
    eventId: token,
  });
};

export const sendPasswordResetEmail = async (
  email: string,
  name: string,
  token: string,
) => {
  console.log("[EmailService] 📧 Preparing password reset email");
  console.log("[EmailService] Recipient:", email);
  console.log("[EmailService] Name:", name);
  console.log(
    "[EmailService] Token (first 15):",
    token.substring(0, 15) + "...",
  );

  const link = `${env.MA_FRONTEND_URL}/reset-password?token=${token}`;
  console.log("[EmailService] Reset link:", link);

  const html = getEmailTemplate(
    `
        <div class="header" style="background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);">
            <h1>Reset Password</h1>
        </div>
        <div class="content">
            <p>Hi ${name},</p>
            <p>We received a request to reset your password. Click below to proceed:</p>
            <div style="text-align: center;">
                <a href="${link}" class="button" style="background: #ef4444;">Reset Password</a>
            </div>
            <div class="highlight-box" style="border-color: #ef4444;">
                <p>If you did not request this, please ignore this email.</p>
            </div>
        </div>
    `,
    "#ef4444",
  );

  console.log("[EmailService] Queueing email...");
  await queueEmail(email, "Reset Password Request", html, {
    priority: "high",
    eventType: "reset_pass",
    eventId: token,
  });
  console.log("[EmailService] ✅ Email queued successfully");
};

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
  const html = getEmailTemplate(
    `
        <div class="header" style="background: #10b981;">
            <h1>Payment Successful!</h1>
        </div>
        <div class="content">
            <p>Dear <strong>${name}</strong>,</p>
            <p>We have received your payment for <strong>${courseName}</strong>.</p>
            
            <div class="highlight-box">
                <p><strong>Amount:</strong> ${amount} ${displayCurrency}</p>
                <p><strong>Transaction ID:</strong> ${transactionId}</p>
                <p><strong>Status:</strong> <span style="color:#10b981; font-weight:bold;">PAID</span></p>
            </div>
            
            <p>You can now access your dashboard and start learning!</p>
            <div style="text-align: center;">
                <a href="${env.MA_FRONTEND_URL}/my-classes" class="button">Go to Dashboard</a>
            </div>
        </div>
    `,
    "#10b981",
  );

  await queueEmail(email, "Payment Receipt", html, {
    eventType: "payment_success",
    eventId: transactionId,
  });
};

export const sendPaymentReviewEmail = async (
  student: any,
  courseName: string,
  transactionId: string,
) => {
  const html = getEmailTemplate(
    `
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
    `,
    "#f59e0b",
  );

  await queueEmail(student.email, "Payment Under Review", html, {
    eventType: "payment_review",
    eventId: transactionId,
  });
};

export const sendPaymentFailedEmail = async (
  student: any,
  courseName: string,
  reason: string,
) => {
  const html = getEmailTemplate(
    `
        <div class="header" style="background: #ef4444;">
            <h1>Payment Failed</h1>
        </div>
        <div class="content">
            <p>Dear ${student.name},</p>
            <p>Your payment for <strong>${courseName}</strong> could not be completed.</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>Please try again or contact support.</p>
        </div>
    `,
    "#ef4444",
  );

  await queueEmail(student.email, "Payment Failed", html, { priority: "high" });
};

// --- EMPLOYEE ---

export const sendEmployeeSalaryPaidEmail = async (params: {
  email: string;
  name: string;
  salaryId: string;
  month?: string;
  year?: number;
  amount?: number;
  bonus?: number;
  totalAmount?: number;
  paymentDate?: string | Date | null;
  jobTitle?: string;
}) => {
  const {
    email,
    name,
    salaryId,
    month,
    year,
    amount = 0,
    bonus = 0,
    totalAmount,
    paymentDate,
    jobTitle,
  } = params;

  const period =
    month && year
      ? `${month} ${year}`
      : month || year
        ? `${month ?? ""} ${year ?? ""}`.trim()
        : "N/A";
  const paidTotal = totalAmount ?? amount + bonus;
  const formattedPaymentDate = paymentDate
    ? new Date(paymentDate).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "Not provided";

  const html = getEmailTemplate(
    `
        <div class="header" style="background: #10b981;">
            <h1>আপনার স্যালারি এসেছে 🎉</h1>
        </div>
        <div class="content">
            <p>হ্যালো <strong>${name}</strong>,</p>
            <p>ভালো খবর! আপনার স্যালারি সফলভাবে প্রসেস হয়েছে।</p>
            <p>আপনার দারুণ কাজের জন্য অনেক ধন্যবাদ! 🎉 ব্যাংক/ওয়ালেটে ক্রেডিট হতে সামান্য সময় লাগতে পারে—কোনো অমিল মনে হলে আমাদের জানাবেন, সমাধান করার চেষ্টা করবো।</p>
            <p>সংক্ষিপ্ত ডিটেইলস :</p>
            <div class="highlight-box">
                <p><strong>Period:</strong> ${period}</p>
                ${jobTitle ? `<p><strong>Designation:</strong> ${jobTitle}</p>` : ""}
                <p><strong>Gross Salary:</strong> BDT ${amount.toLocaleString()}</p>
                <p><strong>Bonus:</strong> BDT ${bonus.toLocaleString()}</p>
                <p><strong>Total Paid:</strong> BDT ${paidTotal.toLocaleString()}</p>
                <p><strong>Payment Date:</strong> ${formattedPaymentDate}</p>
                <p><strong>Status:</strong> <span style="color:#10b981; font-weight:bold;">PAID</span></p>
            </div>
            <p>কোনো প্রশ্ন থাকলে জানাবেন—আমরা আছি পাশেই।</p>
        </div>
    `,
    "#10b981",
  );

  await queueEmail(email, "আপনার স্যালারি এসেছে 🎉", html, {
    eventType: "salary_paid",
    eventId: salaryId,
    priority: "normal",
  });
};

export const sendEmployeeBirthdayReminderEmail = async (params: {
  to: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  employeePhone: string;
  employeeAddress: string;
  designation: string;
  dateOfBirth: Date;
  upcomingBirthday: Date;
  daysUntil: number;
  ageTurning: number;
}) => {
  const {
    to,
    employeeId,
    employeeName,
    employeeEmail,
    employeePhone,
    employeeAddress,
    designation,
    dateOfBirth,
    upcomingBirthday,
    daysUntil,
    ageTurning,
  } = params;

  const dobText = dateOfBirth.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const upcomingText = upcomingBirthday.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const html = getEmailTemplate(
    `
        <div class="header" style="background: #3b82f6;">
            <h1>Employee Birthday Reminder</h1>
        </div>
        <div class="content">
            <p>Hello Team,</p>
            <p>An employee birthday is coming up in <strong>${daysUntil}</strong> days.</p>
            <div class="highlight-box" style="border-color: #3b82f6;">
                <p><strong>Name:</strong> ${employeeName}</p>
                <p><strong>Email:</strong> ${employeeEmail}</p>
                <p><strong>Phone:</strong> ${employeePhone}</p>
                <p><strong>Address:</strong> ${employeeAddress}</p>
                <p><strong>Designation:</strong> ${designation}</p>
                <p><strong>Date of Birth:</strong> ${dobText}</p>
                <p><strong>Birthday Date:</strong> ${upcomingText}</p>
                <p><strong>Turning Age:</strong> ${ageTurning}</p>
            </div>
            <p>Please plan a birthday wish or celebration accordingly.</p>
        </div>
    `,
    "#3b82f6",
  );

  const eventId = `${employeeId}-${upcomingBirthday.toISOString().slice(0, 10)}`;

  await queueEmail(to, "Employee Birthday Reminder", html, {
    eventType: "employee_birthday_reminder",
    eventId,
    priority: "normal",
  });
};

// --- ACADEMIC ---

export const sendBatchStartReminderEmail = async (
  studentEmail: string,
  studentName: string,
  batchName: string,
  startDate: string,
) => {
  const html = getEmailTemplate(
    `
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
    `,
    "#3b82f6",
  );

  await queueEmail(studentEmail, `Reminder: ${batchName} Starts Soon`, html);
};

export const sendCertificateApprovedEmail = async (
  studentEmail: string,
  studentName: string,
  courseName: string,
  certificateId: string,
) => {
  const html = getEmailTemplate(
    `
        <div class="header" style="background: linear-gradient(to right, #D4AF37, #C5A028);">
            <h1>🎓 Certificate Approved!</h1>
        </div>
        <div class="content">
            <p>Congratulations <strong>${studentName}</strong>!</p>
            <p>Your certificate request for <strong>${courseName}</strong> has been approved.</p>
            <p>Your certificate will be issued soon.</p>
            <p>Certificate ID: <strong>${certificateId}</strong></p>
        </div>
    `,
    "#D4AF37",
  );

  await queueEmail(studentEmail, "Certificate Request Approved", html, {
    priority: "normal",
  });
};

export const sendCertificateIssuedEmail = async (
  studentEmail: string,
  studentName: string,
  courseName: string,
  certificateLink: string,
) => {
  const html = getEmailTemplate(
    `
        <div class="header" style="background: linear-gradient(to right, #D4AF37, #C5A028);">
            <h1>🎓 Certificate Issued!</h1>
        </div>
        <div class="content">
            <p>Congratulations <strong>${studentName}</strong>!</p>
            <p>You have successfully completed <strong>${courseName}</strong>.</p>
            <p>Your certificate is ready for download.</p>
            <div style="text-align: center;">
                <a href="${certificateLink}" class="button" style="background: #D4AF37; color: #fff;">Download Certificate</a>
            </div>
            <p>Don't forget to share it on LinkedIn!</p>
        </div>
    `,
    "#D4AF37",
  );

  await queueEmail(studentEmail, "Your Certificate is Ready!", html, {
    priority: "normal",
  });
};

export const sendEnrollmentConfirmationEmail = async (
  user: any,
  courseName: string,
  enrollmentId: string,
  amount: number,
  paymentMethod?: string,
) => {
  const paymentAmount = amount;
  const displayCurrency = getDisplayCurrency("BDT", paymentMethod);
  const { facebookGroupLink, whatsappGroupLink } =
    await resolveGroupLinks(courseName);
  const html = getEmailTemplate(
    `
        <div class="header" style="background: #10b981;">
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
                                We are thrilled to welcome you to the Misun Academy learning community. This comprehensive course is designed to equip you with industry-standard design skills.
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
                            <a href="${env.MA_FRONTEND_URL}/my-classes" style="display: inline-block; padding: 14px 30px; background-color: #10b981; color: #ffffff; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px;">Go to Dashboard</a>
                        </td>
                    </tr>
                    

                </table>
            </td>
        </tr>
    </table>
        </div>
    `,
    "#10b981",
  );

  await queueEmail(user.email, "Enrollment Confirmation", html, {
    eventType: "enrollment_confirm",
    eventId: enrollmentId,
  });
};

export const sendWaitingPaymentVerificationEmail = async (
  student: any,
  courseName: string,
  transactionId: string,
) => {
  const html = getEmailTemplate(
    `
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
    `,
    "#f59e0b",
  );
  await queueEmail(student.email, "Payment Verification Pending", html, {
    eventType: "payment_verification",
    eventId: transactionId,
  });
};

// --- ADMIN BULK EMAILS ---

/**
 * Send enrollment reminder to registered but not enrolled users
 */
export const sendEnrollmentReminderEmail = async (
  email: string,
  name: string,
) => {
  const html = getEmailTemplate(
    `
        <div class="header" style="background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);">
            <h1>📚 Start Your Learning Journey!</h1>
        </div>
        <div class="content">
            <p>Hi <strong>${name}</strong>,</p>
            <p>We noticed you registered with Misun Academy but haven't enrolled in any course yet.</p>
            
            <div class="highlight-box" style="border-color: #8b5cf6;">
                <h3 style="color: #8b5cf6; margin-top: 0;">Why Choose Misun Academy?</h3>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>Industry-standard curriculum</li>
                    <li>Expert instructors with real-world experience</li>
                    <li>Lifetime access to course materials</li>
                    <li>Certificate upon completion</li>
                </ul>
            </div>
            
            <p>Don't miss out on this opportunity to upskill yourself and advance your career!</p>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${env.MA_FRONTEND_URL}/courses" class="button" style="background: #8b5cf6;">Browse Courses</a>
            </div>
            
            <p style="font-size: 14px; color: #666;">Have questions? Feel free to reach out to us at <a href="mailto:misunacademybd@gmail.com">misunacademybd@gmail.com</a></p>
        </div>
    `,
    "#8b5cf6",
  );

  await queueEmail(email, "Complete Your Enrollment - Misun Academy", html, {
    priority: "normal",
    eventType: "enrollment_reminder",
  });
};

/**
 * Send news and updates to all enrolled students
 */
export const sendNewsUpdateEmail = async (
  email: string,
  name: string,
  subject: string,
  message: string,
) => {
  const html = getEmailTemplate(
    `
        <div class="header" style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);">
            <h1>📢 ${subject}</h1>
        </div>
        <div class="content">
            <p>Hi <strong>${name}</strong>,</p>
            
            <div style="margin: 30px 0; font-size: 16px; line-height: 1.8;">
                ${message}
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${env.MA_FRONTEND_URL}/my-classes" class="button" style="background: #3b82f6;">Go to Dashboard</a>
            </div>
            
            <p style="font-size: 14px; color: #666;">Stay tuned for more updates!</p>
        </div>
    `,
    "#3b82f6",
  );

  await queueEmail(email, subject, html, {
    priority: "normal",
    eventType: "news_update",
  });
};

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
  const html = getEmailTemplate(
    `
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
                <p><strong>স্টুডেন্ট:</strong> ${name || "Student"}</p>
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
    `,
    "#f59e0b",
  );

  await queueEmail(
    email,
    "তুমি ক্লাস রেকর্ডগুলো ঠিকমতো দেখছো না, তুমি কি কোনো প্রবলেমে আছো?",
    html,
    {
      priority: "normal",
      eventType: "batch_progress_reminder",
    },
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
  const html = getEmailTemplate(
    `
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
                <p><strong>স্টুডেন্ট:</strong> ${name || "Student"}</p>
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
    `,
    "#3b82f6",
  );

  await queueEmail(
    email,
    "তোমার কোর্স এখনো অসম্পূর্ণ — আমরা তোমাকে সাহায্য করতে চাই",
    html,
    {
      priority: "normal",
      eventType: "batch_incomplete_reminder",
    },
  );
};
