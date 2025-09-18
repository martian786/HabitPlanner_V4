import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import MFAEnrollment from './MFAEnrollment';
import type { Factor } from '@supabase/supabase-js';

export default function MFASettings() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [error, setError] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  useEffect(() => {
    loadFactors();
  }, []);

  const loadFactors = async () => {
    try {
      setLoading(true);
      setError('');

      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;

      setFactors(data?.totp || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load MFA settings');
    } finally {
      setLoading(false);
    }
  };

  const unenrollFactor = async (factorId: string) => {
    if (!confirm('Are you sure you want to disable two-factor authentication? This will make your account less secure.')) {
      return;
    }

    try {
      setError('');

      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;

      await loadFactors();
      setSuccessMessage('Two-factor authentication has been disabled.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to disable MFA');
    }
  };

  const handleEnrollmentComplete = () => {
    setShowEnrollment(false);
    loadFactors();
    setSuccessMessage('Two-factor authentication has been enabled successfully!');
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  const isEnabled = factors.length > 0;

  return (
    <div className="p-6">
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold mb-4">Two-Factor Authentication</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
            ✅ {successMessage}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-medium text-gray-900 mb-1">
                Authenticator App
              </h3>
              <p className="text-sm text-gray-600">
                Use an authenticator app to generate verification codes for enhanced security.
              </p>
            </div>
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${
              isEnabled
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {isEnabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>

          {isEnabled && (
            <div className="mb-4">
              {factors.map((factor) => (
                <div key={factor.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium text-sm">{factor.friendly_name || 'Authenticator App'}</div>
                    <div className="text-xs text-gray-500">
                      Created {new Date(factor.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => unenrollFactor(factor.id)}
                    className="text-red-600 hover:text-red-700 text-sm font-medium"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="pt-4 border-t border-gray-100">
            {!isEnabled ? (
              <div>
                <div className="mb-4">
                  <h4 className="font-medium text-sm text-gray-900 mb-2">Benefits of Two-Factor Authentication:</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Protects your account even if your password is compromised</li>
                    <li>• Prevents unauthorized access to your data</li>
                    <li>• Works with popular apps like Google Authenticator and Authy</li>
                    <li>• Industry standard for account security</li>
                  </ul>
                </div>
                <button
                  onClick={() => setShowEnrollment(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
                >
                  Enable Two-Factor Authentication
                </button>
              </div>
            ) : (
              <div className="flex items-center text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Your account is protected with two-factor authentication.
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 p-4 bg-blue-50 rounded-lg">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-blue-600 mt-0.5 mr-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div>
              <h4 className="font-medium text-blue-900 mb-1">Important Security Tips</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Keep backup codes in a safe place</li>
                <li>• Use a reputable authenticator app</li>
                <li>• Don't share verification codes with anyone</li>
                <li>• Update your authenticator app if you get a new device</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {showEnrollment && (
        <MFAEnrollment
          onEnrollmentComplete={handleEnrollmentComplete}
          onClose={() => setShowEnrollment(false)}
        />
      )}
    </div>
  );
}