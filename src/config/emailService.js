const nodemailer = require('nodemailer');
const supabase = require('./supabase');

async function sendWelcomeEmail(toEmail, businessName) {
  try {
    // Debug: Check if we can access 'clients' table
    const { data: clientsData, error: clientsError } = await supabase.from('clients').select('count', { count: 'exact', head: true });
    console.log('Access to clients table - Error:', clientsError?.message, 'Data:', clientsData);

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
    if (!config.enabled) {
      console.log('Email notifications are disabled in config');
      return;
    }

    // 2. Setup Transporter
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465, // true for 465, false for others
      auth: {
        user: config.user,
        pass: config.pass,
      },
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
      from: config.from,
      to: toEmail,
      subject: `Welcome to FitOps, ${businessName}! 🚀`,
      html: htmlContent,
    });

    console.log(`[SUCCESS] Welcome email sent to ${toEmail}`);
  } catch (err) {
    console.error('[ERROR] Failed to send email:', err.message);
  }
}

module.exports = { sendWelcomeEmail };
