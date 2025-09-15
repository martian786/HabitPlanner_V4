import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface MFAEnrollmentProps {
  onEnrollmentComplete?: () => void;
  onClose?: () => void;
}

export default function MFAEnrollment({ onEnrollmentComplete, onClose }: MFAEnrollmentProps) {
  const [step, setStep] = useState<'enroll' | 'verify' | 'success'>('enroll');
  const [qrCode, setQrCode] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [factorId, setFactorId] = useState<string>('');
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const startEnrollment = async () => {
    try {
      setLoading(true);
      setError('');

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Auth App ${Date.now()}-${Math.random().toString(36).substring(2)}`
      });

      if (error) throw error;

      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFactorId(data.id);
      setStep('verify');
    } catch (err: any) {
      setError(err.message || 'Failed to start MFA enrollment');
    } finally {
      setLoading(false);
    }
  };

  const verifyEnrollment = async () => {
    if (!verificationCode.trim()) {
      setError('Please enter the verification code');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // For MFA enrollment verification, we need to use challengeId differently
      // First get the challenge from the enrollment data
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId
      });

      if (challengeError) {
        throw challengeError;
      }

      // Then verify with the proper challenge ID
      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: verificationCode
      });

      if (error) throw error;

      // Refresh session after MFA enrollment to maintain authentication
      await supabase.auth.refreshSession();

      // MFA enrollment successful
      setStep('success');
      setTimeout(() => {
        onEnrollmentComplete?.();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please check your code and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    startEnrollment();
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Enable Two-Factor Authentication</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {step === 'enroll' && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2">Setting up two-factor authentication...</p>
          </div>
        )}

        {step === 'success' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">MFA Enabled Successfully!</h3>
            <p className="text-gray-600 mb-4">
              Two-factor authentication has been enabled for your account. Your account is now more secure.
            </p>
            <p className="text-sm text-gray-500">
              Returning to settings...
            </p>
          </div>
        )}

        {step === 'verify' && (
          <div>
            <div className="mb-4">
              <h3 className="font-medium mb-2">Step 1: Scan QR Code</h3>
              <p className="text-sm text-gray-600 mb-3">
                Open your authenticator app (Google Authenticator, Authy, etc.) and scan this QR code:
              </p>
              {qrCode && (
                <div className="flex justify-center mb-4">
                  <img src={qrCode} alt="QR Code for MFA setup" className="border rounded" />
                </div>
              )}

              <p className="text-sm text-gray-600 mb-2">
                Can't scan? Enter this code manually:
              </p>
              <div className="bg-gray-100 p-2 rounded font-mono text-sm break-all">
                {secret}
              </div>
            </div>

            <div className="mb-4">
              <h3 className="font-medium mb-2">Step 2: Enter Verification Code</h3>
              <p className="text-sm text-gray-600 mb-3">
                Enter the 6-digit code from your authenticator app:
              </p>
              <input
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full p-3 border border-gray-300 rounded-lg text-center font-mono text-lg"
                maxLength={6}
              />
            </div>

            <div className="flex space-x-3">
              {onClose && (
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={verifyEnrollment}
                disabled={loading || verificationCode.length !== 6}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Enable MFA'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}