// Development mailer: prints each email to the console and keeps it in memory.
// To send real email, pass createApp() any object with the same send() method
// (for example one that calls your email provider's API).

function createConsoleMailer({ log = console.log } = {}) {
  const sent = [];
  return {
    sent,
    async send({ to, subject, text }) {
      sent.push({ to, subject, text });
      log(`\n--- email to ${to} ---\nSubject: ${subject}\n\n${text}\n---\n`);
    },
  };
}

module.exports = { createConsoleMailer };
