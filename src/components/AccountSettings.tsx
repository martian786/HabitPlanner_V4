import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import MFASettings from './MFASettings';

interface AccountSettingsProps {
  session: Session;
  onClose: () => void;
}

export default function AccountSettings({ session, onClose }: AccountSettingsProps) {
  const [activeTab, setActiveTab] = useState<'security' | 'profile' | 'preferences'>('security');
  const [loading, setLoading] = useState(false);
  const [displayName, setDisplayName] = useState(session.user.user_metadata?.display_name || session.user.user_metadata?.full_name || '');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [preferences, setPreferences] = useState({
    emailReminders: true,
    weeklyReports: false,
    securityAlerts: true,
    showPercentages: true,
    compactView: false,
  });
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesSuccess, setPreferencesSuccess] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Load preferences from database on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const { data, error } = await supabase
          .from('account_preferences')
          .select('*')
          .eq('user_id', session.user.id)
          .single();

        if (error) {
          // If no preferences found, create them with defaults
          console.log('No preferences found, creating defaults');
          try {
            await supabase
              .from('account_preferences')
              .insert([{
                user_id: session.user.id,
                email_reminders: true,
                weekly_reports: false,
                security_alerts: true,
                show_percentages: true,
                compact_view: false
              }]);
          } catch (insertError) {
            console.error('Failed to create default preferences:', insertError);
          }
          return;
        }

        if (data) {
          setPreferences({
            emailReminders: data.email_reminders,
            weeklyReports: data.weekly_reports,
            securityAlerts: data.security_alerts,
            showPercentages: data.show_percentages,
            compactView: data.compact_view,
          });
        }
      } catch (error) {
        console.error('Failed to load preferences:', error);
      }
    };

    loadPreferences();
  }, [session]);

  const tabs = [
    { id: 'security' as const, name: 'Security', icon: '🔒' },
    { id: 'profile' as const, name: 'Profile', icon: '👤' },
    { id: 'preferences' as const, name: 'Preferences', icon: '⚙️' },
  ];

  const handleSignOut = async () => {
    if (!confirm('Are you sure you want to sign out?')) return;

    setLoading(true);
    try {
      console.log("Signing out and clearing all data");
      localStorage.clear();
      await supabase.auth.signOut({ scope: 'global' });
      window.location.reload();
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!displayName.trim()) return;

    setSaving(true);
    setSaveSuccess(false);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { display_name: displayName.trim() }
      });

      if (error) throw error;

      setSaveSuccess(true);
      // Hide success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error: any) {
      alert(error.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePreferences = async () => {
    setSavingPreferences(true);
    setPreferencesSuccess(false);
    try {
      const { error } = await supabase
        .from('account_preferences')
        .upsert([{
          user_id: session.user.id,
          email_reminders: preferences.emailReminders,
          weekly_reports: preferences.weeklyReports,
          security_alerts: preferences.securityAlerts,
          show_percentages: preferences.showPercentages,
          compact_view: preferences.compactView,
        }], {
          onConflict: 'user_id'
        });

      if (error) throw error;

      setPreferencesSuccess(true);
      setTimeout(() => setPreferencesSuccess(false), 3000);
    } catch (error: any) {
      console.error('Failed to save preferences:', error);
      alert(error.message || 'Failed to save preferences');
    } finally {
      setSavingPreferences(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      alert('New passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      alert('Password must be at least 6 characters long');
      return;
    }

    setChangingPassword(true);
    setPasswordSuccess(false);

    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword
      });

      if (error) throw error;

      setPasswordSuccess(true);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => {
        setPasswordSuccess(false);
        setShowChangePassword(false);
      }, 3000);
    } catch (error: any) {
      alert(error.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-semibold text-gray-900">Account Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col sm:flex-row">
          {/* Sidebar */}
          <div className="w-full sm:w-64 bg-gray-50 border-r border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
                  {session.user.email?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-gray-900 truncate">
                    {session.user.user_metadata?.display_name || session.user.user_metadata?.full_name || 'User'}
                  </div>
                  <div className="text-sm text-gray-500 truncate">
                    {session.user.email}
                  </div>
                </div>
              </div>
            </div>

            <nav className="p-4 space-y-1 sm:space-y-1">
              <div className="flex sm:flex-col space-x-2 sm:space-x-0 sm:space-y-1 overflow-x-auto sm:overflow-x-visible">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span>{tab.icon}</span>
                    <span>{tab.name}</span>
                  </button>
                ))}
              </div>

              <div className="pt-4 border-t border-gray-200 mt-4">
                <button
                  onClick={handleSignOut}
                  disabled={loading}
                  className="w-full flex items-center space-x-3 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 rounded-lg text-left disabled:opacity-50"
                >
                  <span>🚪</span>
                  <span>{loading ? 'Signing out...' : 'Sign Out'}</span>
                </button>
              </div>
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
            {activeTab === 'security' && (
              <div>
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Security Settings</h3>
                  <p className="text-gray-600">
                    Manage your account security and authentication preferences.
                  </p>
                </div>
                <MFASettings />

                {/* Additional Security Settings */}
                <div className="p-6 border-t border-gray-100">
                  <h4 className="font-medium text-gray-900 mb-4">Password</h4>
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Password</div>
                        <div className="text-sm text-gray-500">
                          Last changed {new Date(session.user.updated_at || '').toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => setShowChangePassword(true)}
                        className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                      >
                        Change Password
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'profile' && (
              <div>
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Profile Information</h3>
                  <p className="text-gray-600">
                    Update your personal information and profile details.
                  </p>
                </div>
                <div className="p-6">
                  <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={session.user.email || ''}
                      disabled
                      className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                    />
                    <p className="text-sm text-gray-500 mt-1">
                      Email changes require verification and may affect your subscription.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                      placeholder="Enter your display name"
                    />
                    <p className="text-sm text-gray-500 mt-1">
                      This name will be displayed in your account and profile.
                    </p>
                  </div>

                  {saveSuccess && (
                    <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
                      ✅ Display name updated successfully!
                    </div>
                  )}

                    <div className="pt-6 pb-4">
                      <button
                        onClick={handleSaveProfile}
                        disabled={saving || !displayName.trim()}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'preferences' && (
              <div>
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Preferences</h3>
                  <p className="text-gray-600">
                    Customize your app experience and notification settings.
                  </p>
                </div>
                <div className="p-6">
                  {preferencesSuccess && (
                    <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
                      ✅ Preferences updated successfully!
                    </div>
                  )}

                  <div className="space-y-6">
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">Notifications</h4>
                      <div className="space-y-3">
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            className="mr-3 rounded"
                            checked={preferences.emailReminders}
                            onChange={(e) => setPreferences({...preferences, emailReminders: e.target.checked})}
                          />
                          <span className="text-sm">Email reminders for scheduled activities</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            className="mr-3 rounded"
                            checked={preferences.weeklyReports}
                            onChange={(e) => setPreferences({...preferences, weeklyReports: e.target.checked})}
                          />
                          <span className="text-sm">Weekly progress reports</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            className="mr-3 rounded"
                            checked={preferences.securityAlerts}
                            onChange={(e) => setPreferences({...preferences, securityAlerts: e.target.checked})}
                          />
                          <span className="text-sm">Security alerts</span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">Display</h4>
                      <div className="space-y-3">
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            className="mr-3 rounded"
                            checked={preferences.showPercentages}
                            onChange={(e) => setPreferences({...preferences, showPercentages: e.target.checked})}
                          />
                          <span className="text-sm">Show completion percentages</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            className="mr-3 rounded"
                            checked={preferences.compactView}
                            onChange={(e) => setPreferences({...preferences, compactView: e.target.checked})}
                          />
                          <span className="text-sm">Compact view mode</span>
                        </label>
                      </div>
                    </div>

                    <div className="pt-4">
                      <button
                        onClick={handleSavePreferences}
                        disabled={savingPreferences}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {savingPreferences ? 'Saving...' : 'Save Preferences'}
                      </button>
                    </div>
                </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Change Password Modal */}
      {showChangePassword && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Change Password</h3>
              <button
                onClick={() => setShowChangePassword(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            {passwordSuccess && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
                ✅ Password changed successfully!
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={passwordData.currentPassword}
                  onChange={(e) => setPasswordData({...passwordData, currentPassword: e.target.value})}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                  placeholder="Enter current password"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                  placeholder="Enter new password"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                  placeholder="Confirm new password"
                />
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowChangePassword(false)}
                disabled={changingPassword}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={changingPassword || !passwordData.newPassword || !passwordData.confirmPassword}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {changingPassword ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}