import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { AuthMFAChallengeResponse } from '@supabase/supabase-js';

interface MFAChallengeProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function MFAChallenge({ onSuccess, onCancel }: MFAChallengeProps) {
  const [challengeId, setChallengeId] = useState<string>('');
  const [factorId, setFactorId] = useState<string>('');
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    initializeChallenge();
  }, []);

  const initializeChallenge = async () => {
    try {
      setLoading(true);
      setError('');

      // Get user's MFA factors
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;

      if (!factors || factors.totp.length === 0) {
        throw new Error('No MFA factors found');
      }

      const factor = factors.totp[0];
      setFactorId(factor.id);

      // Create challenge
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: factor.id
      });

      if (challengeError) throw challengeError;

      const challengeResponse = challenge as AuthMFAChallengeResponse;
      setChallengeId(challengeResponse.id);
    } catch (err: any) {
      setError(err.message || 'Failed to initialize MFA challenge');
    } finally {
      setLoading(false);
    }
  };

  const verifyChallenge = async () => {
    if (!verificationCode.trim()) {
      setError('Please enter the verification code');
      return;
    }

    try {
      setVerifying(true);
      setError('');

      const { data, error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: verificationCode
      });

      if (error) throw error;

      // Verification successful - refresh session to get aal2
      await supabase.auth.refreshSession();

      // Mark MFA as completed for this session to prevent repeated challenges
      sessionStorage.setItem('mfa_completed', 'true');

      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please check your code and try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !verifying && verificationCode.length === 6) {
      verifyChallenge();
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2">Setting up verification...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Two-Factor Authentication</h2>
          <p className="text-gray-600">
            Enter the 6-digit code from your authenticator app to continue.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="mb-6">
          <input
            type="text"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={handleKeyPress}
            placeholder="123456"
            className="w-full p-4 border border-gray-300 rounded-lg text-center font-mono text-xl tracking-wider"
            maxLength={6}
            autoFocus
          />
        </div>

        <div className="flex space-x-3">
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={verifying}
              className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={verifyChallenge}
            disabled={verifying || verificationCode.length !== 6}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {verifying ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Verifying...
              </div>
            ) : (
              'Verify'
            )}
          </button>
        </div>

        <div className="mt-4 text-center">
          <p className="text-sm text-gray-500">
            Having trouble? Make sure your device's time is synchronized and try again.
          </p>
        </div>
      </div>
    </div>
  );
}