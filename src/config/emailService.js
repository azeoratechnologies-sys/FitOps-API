const nodemailer = require('nodemailer');
const supabase = require('./supabase');

async function sendWelcomeEmail(toEmail, businessName) {
  try {
    // Debug: Check if we can access 'clients' table
    const { count, error: clientsError } = await supabase.from('clients').select('*', { count: 'exact', head: true });
    console.log('Access to clients table - Error:', clientsError?.message, 'Count:', count);

    // Debug: Fetch all config rows to see what exists
    const { data: allConfigs, error: allConfigsError } = await supabase.from('system_config').select('*');
    console.log('All system_config rows:', allConfigs, 'Error:', allConfigsError?.message);

    const { data, error } = await supabase
      .from('system_config')
      .select('config_value')
      .eq('config_key', 'email_settings')
      .single();

    if (error || !data) {
      console.error('Email config fetch error:', error?.message || error);
      console.error('Data returned:', data);
      return;
    }

    const config = data.config_value;
    
    // Allow local overrides via .env for testing
    const user = process.env.EMAIL_USER || config.user;
    const pass = process.env.EMAIL_PASS || config.pass;
    const from = process.env.EMAIL_FROM || config.from;

    if (!config.enabled && !process.env.EMAIL_USER) {
      console.log('Email notifications are disabled in config');
      return;
    }

    // 2. Setup Transporter
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465, // true for 465, false for others
      auth: {
        user: user,
        pass: pass,
      },
      connectionTimeout: 5000, // 5 seconds
      socketTimeout: 5000,     // 5 seconds
    });

    // 3. Define HTML Template
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f9; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: #ffffff; padding: 40px 20px; text-align: center; }
            .header h1 { margin: 0; font-size: 28px; letter-spacing: 1px; }
            .content { padding: 30px; line-height: 1.6; }
            .content h2 { color: #1e3c72; margin-top: 0; }
            .badge { display: inline-block; padding: 6px 12px; background: #e3f2fd; color: #1e3c72; border-radius: 20px; font-weight: bold; font-size: 14px; margin-bottom: 20px; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #777; border-top: 1px solid #eeeeee; }
            .button { display: inline-block; padding: 12px 24px; background-color: #1e3c72; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>FitOps</h1>
            </div>
            <div class="content">
                <div class="badge">Registration Successful</div>
                <h2>Welcome, ${businessName}!</h2>
                <p>We're thrilled to have you on board! Your business account has been successfully created and your <strong>15-day free trial</strong> is now active.</p>
                <p>FitOps is designed to help you manage your tailoring operations with cloud sync, inventory tracking, and customer management all in one place.</p>
                <a href="https://fitops.com/login" class="button">Get Started Now</a>
                <p style="margin-top: 30px;">If you have any questions, simply reply to this email. Our team is here to help!</p>
                <p>Best regards,<br>The FitOps Team</p>
            </div>
            <div class="footer">
                &copy; ${new Date().getFullYear()} FitOps Industrial Tailoring. All rights reserved.<br>
                This is an automated message, please do not reply directly.
            </div>
        </div>
    </body>
    </html>
    `;

    // 4. Send Email
    await transporter.sendMail({
      from: from,
      to: toEmail,
      subject: `Welcome to FitOps, ${businessName}! 🚀`,
      html: htmlContent,
    });

    console.log(`[SUCCESS] Welcome email sent to ${toEmail}`);
  } catch (err) {
    console.error('[ERROR] Failed to send email:', err.message);
  }
}

async function sendRenewalEmail(toEmail, businessName, planName, expiryDate) {
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('config_value')
      .eq('config_key', 'email_settings')
      .single();

    if (error || !data) return;

    const config = data.config_value;
    const user = process.env.EMAIL_USER || config.user;
    const pass = process.env.EMAIL_PASS || config.pass;
    const from = process.env.EMAIL_FROM || config.from;

    if (!config.enabled && !process.env.EMAIL_USER) return;

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user, pass },
    });

    const formattedDate = new Date(expiryDate).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f9; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: #ffffff; padding: 40px 20px; text-align: center; }
            .header h1 { margin: 0; font-size: 28px; letter-spacing: 1px; }
            .content { padding: 30px; line-height: 1.6; }
            .content h2 { color: #1e3c72; margin-top: 0; }
            .badge { display: inline-block; padding: 6px 12px; background: #e8f5e9; color: #2e7d32; border-radius: 20px; font-weight: bold; font-size: 14px; margin-bottom: 20px; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #777; border-top: 1px solid #eeeeee; }
            .details { background: #f1f3f4; padding: 15px; border-radius: 8px; margin: 20px 0; }
            .details-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>FitOps</h1>
            </div>
            <div class="content">
                <div class="badge">Subscription Renewed</div>
                <h2>Thank you for your renewal, ${businessName}!</h2>
                <p>Your FitOps subscription has been successfully updated. We are excited to continue helping you grow your business.</p>
                
                <div class="details">
                    <div class="details-row"><strong>Plan Name:</strong> <span>${planName}</span></div>
                    <div class="details-row"><strong>New Expiry Date:</strong> <span>${formattedDate}</span></div>
                    <div class="details-row"><strong>Status:</strong> <span>Active</span></div>
                </div>

                <p>All your data and settings remain safe and are currently being synced with your cloud account.</p>
                <p style="margin-top: 30px;">If you need an invoice or have any questions, feel free to reply to this email.</p>
                <p>Best regards,<br>The FitOps Team</p>
            </div>
            <div class="footer">
                &copy; ${new Date().getFullYear()} FitOps Industrial Tailoring. All rights reserved.<br>
                This is an automated message, please do not reply directly.
            </div>
        </div>
    </body>
    </html>
    `;

    await transporter.sendMail({
      from,
      to: toEmail,
      subject: `Subscription Renewed Successfully: ${businessName} ✅`,
      html: htmlContent,
    });

    console.log(`[SUCCESS] Renewal email sent to ${toEmail}`);
  } catch (err) {
    console.error('[ERROR] Failed to send renewal email:', err.message);
  }
}

module.exports = { sendWelcomeEmail, sendRenewalEmail };
