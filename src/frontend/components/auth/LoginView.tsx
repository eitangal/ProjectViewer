import React, { useState, useEffect } from 'react';
import { Mail, KeyRound, ArrowRight, CheckCircle2, ShieldCheck, Loader2 } from 'lucide-react';

export const LoginView: React.FC<{
  onLoginSuccess: (user: any, redirectProjectId: string | null) => void;
}> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  // Check for 1-click magic link query param token on page load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const magicToken = urlParams.get('token');
    if (magicToken) {
      setIsLoading(true);
      fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magicToken }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.authenticated) {
            onLoginSuccess(data.user, data.redirectProjectId);
          } else {
            setErrorMessage(data.error || 'Magic link verification failed.');
          }
        })
        .catch((err) => {
          setErrorMessage(err.message || 'Verification failed');
        })
        .finally(() => setIsLoading(false));
    }
  }, [onLoginSuccess]);

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const res = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      setStep('otp');
      if (data.devOtp) {
        setDevOtp(data.devOtp);
        setOtpCode(data.devOtp); // auto-fill OTP in development
        setInfoMessage(`[Development Mode] Verification code: ${data.devOtp} (auto-filled)`);
      } else {
        setInfoMessage('If your email is registered or invited, a verification challenge has been sent.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to request verification code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          otpCode: otpCode.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');

      onLoginSuccess(data.user, data.redirectProjectId);
    } catch (err: any) {
      setErrorMessage(err.message || 'Incorrect verification code');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center p-4 bg-slate-950 text-slate-100">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl flex flex-col gap-6">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="p-3 bg-indigo-950/60 border border-indigo-800/80 rounded-2xl text-indigo-400 mb-1">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">GitLens-Portal</h1>
          <p className="text-xs text-slate-400 max-w-xs">
            Zero-Trust Git Projection & ACL-Enforced Gemini RAG Portal
          </p>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs">
            {errorMessage}
          </div>
        )}

        {infoMessage && (
          <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-800/80 text-indigo-300 text-xs">
            {infoMessage}
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={handleRequestCode} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-300">Work or Stakeholder Email</label>
              <div className="relative flex items-center">
                <Mail size={16} className="absolute start-3 text-slate-500 pointer-events-none" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl ps-9 pe-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !email.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium py-2.5 rounded-xl transition-colors text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
            >
              {isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <>
                  <span>Send Verification Code</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-300">
                Enter 6-Digit Verification Code
              </label>
              <div className="relative flex items-center">
                <KeyRound size={16} className="absolute start-3 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="123456"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl ps-9 pe-3 py-2 text-sm text-slate-100 font-mono tracking-widest text-center focus:outline-none focus:border-indigo-500"
                />
              </div>
              <span className="text-[11px] text-slate-500 mt-0.5">
                Sent to <span className="text-slate-300 font-mono">{email}</span>. Valid for 15 minutes.
              </span>
            </div>

            <button
              type="submit"
              disabled={isLoading || otpCode.length < 6}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium py-2.5 rounded-xl transition-colors text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
            >
              {isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <>
                  <span>Verify & Sign In</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setStep('email')}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors text-center"
            >
              ← Use a different email
            </button>
          </form>
        )}

        <div className="pt-2 border-t border-slate-800/80 text-center">
          <p className="text-[11px] text-slate-500">
            Invite-only access. In development mode without SMTP, codes appear in server console output.
          </p>
        </div>
      </div>
    </div>
  );
};
