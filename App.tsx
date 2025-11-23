
import React, { useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { LogDataContext, OnboardingData, useLogData } from './hooks/useLogData';
import Dashboard from './components/Dashboard';
import Reports from './components/Reports';
import Settings from './components/Settings';
import BottomNav from './components/BottomNav';
import Calculator from './components/Calculator';
import Onboarding from './components/Onboarding';
import {
  type Page,
  type LogEntry,
  type UserSettings,
  type AddEntryData,
  type Profile,
  EntryType,
  BloodSugarMeasurementType,
} from './types';
import Header from './components/Header';
import { v4 as uuidv4 } from 'uuid';
import { connectToLibre, fetchLatestReadings, disconnectFromLibre as apiDisconnect } from './api/libre';


const initialSettings: UserSettings = {
  glucoseUnit: 'mg/dL',
  targetRange: { low: 70, high: 180 },
  insulinToCarbRatio: 15,
  insulinSensitivityFactor: 50,
  targetGlucose: 120,
  calculationMethod: 'manual',
  tdd: 40,
  notifications: {
    enabled: false,
    highLowAlerts: true,
  },
  libreLinkUp: {
      status: 'disconnected',
      email: '',
      region: 'EU',
      lastSync: null,
  }
};

const LogDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  
  // CRITICAL FIX: Initialize from localStorage synchronously to prevent race conditions
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => {
      try { return localStorage.getItem('diabetesActiveProfileId'); } catch { return null; }
  });
  
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isOnboarding, setIsOnboarding] = useState<boolean | null>(null);
  
  // Refs
  const settingsRef = useRef(initialSettings);
  const activeProfileIdRef = useRef<string | null>(activeProfileId);

  // Sync ref with state
  if (activeProfileId !== null && activeProfileIdRef.current !== activeProfileId) {
      activeProfileIdRef.current = activeProfileId;
  }

  useEffect(() => {
    try {
      const storedProfiles = localStorage.getItem('diabetesProfiles');
      const storedEntries = localStorage.getItem('diabetesLogEntries');
      // storedActiveId is already read in useState initializer

      if (storedProfiles) {
        const loadedProfiles = JSON.parse(storedProfiles);
        if (loadedProfiles.length > 0) {
            setProfiles(loadedProfiles.map((p: Profile) => ({
                ...p,
                settings: {
                    ...initialSettings,
                    ...(p.settings || {}),
                    libreLinkUp: {
                        ...initialSettings.libreLinkUp,
                        ...(p.settings?.libreLinkUp || {}),
                         status: 'disconnected' 
                    }
                }
            })));
            
            // If no active ID found in storage but profiles exist, pick first one
            if (!activeProfileId && loadedProfiles.length > 0) {
                const firstId = loadedProfiles[0].id;
                setActiveProfileId(firstId);
                activeProfileIdRef.current = firstId;
            }
            
            setIsOnboarding(false);
        } else {
           setIsOnboarding(true);
        }
      } else {
          setIsOnboarding(true);
      }

      if (storedEntries) {
        setLogEntries(JSON.parse(storedEntries));
      }

    } catch (error) {
      console.error("Veri yüklenirken hata oluştu:", error);
      setIsOnboarding(true);
    }
  }, []); // Run once on mount

  useEffect(() => {
    try {
        if (profiles.length > 0) {
            localStorage.setItem('diabetesProfiles', JSON.stringify(profiles));
        }
    } catch (error) {
        console.error("Profiller kaydedilirken hata oluştu:", error);
    }
  }, [profiles]);

  useEffect(() => {
    try {
      localStorage.setItem('diabetesLogEntries', JSON.stringify(logEntries));
    } catch (error) {
      console.error("Veri kaydedilirken hata oluştu:", error);
    }
  }, [logEntries]);

  useEffect(() => {
    try {
        if(activeProfileId) {
            localStorage.setItem('diabetesActiveProfileId', activeProfileId);
            activeProfileIdRef.current = activeProfileId;
        }
    } catch (error) {
        console.error("Aktif profil kaydedilirken hata oluştu:", error);
    }
  }, [activeProfileId]);

  const handleOnboardingComplete = (data: OnboardingData) => {
    const newProfile: Profile = {
        id: uuidv4(),
        name: data.name,
        avatar: '👤',
        age: data.age,
        gender: data.gender,
        height: data.height,
        weight: data.weight,
        diabetesDuration: data.diabetesDuration,
        settings: {
            ...initialSettings,
            tdd: data.tdd,
            insulinToCarbRatio: data.insulinToCarbRatio,
            insulinSensitivityFactor: data.insulinSensitivityFactor,
            targetRange: data.targetRange,
            targetGlucose: data.targetGlucose,
        }
    };
    setProfiles([newProfile]);
    setActiveProfileId(newProfile.id);
    activeProfileIdRef.current = newProfile.id;
    setIsOnboarding(false);
  };


  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const settings = activeProfile?.settings ?? initialSettings;
  
  // Update ref whenever settings change
  useEffect(() => {
      settingsRef.current = settings;
  }, [settings]);

  const logEntriesForActiveProfile = logEntries.filter(e => e.profileId === activeProfileId);

  const addEntry = useCallback((entryData: AddEntryData) => {
    if (!activeProfileId) return;
    
    const newEntry: LogEntry = {
      ...entryData,
      id: uuidv4(),
      timestamp: entryData.timestamp || new Date().toISOString(),
      profileId: activeProfileId
    } as LogEntry;

    setLogEntries(prevEntries => [...prevEntries, newEntry].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));

    if (newEntry.type === 'blood_sugar' && settings.notifications.enabled && settings.notifications.highLowAlerts && Notification.permission === 'granted') {
        if(newEntry.value < settings.targetRange.low) {
            new Notification('Düşük Kan Şekeri Uyarısı', {
                body: `Kan şekeriniz ${newEntry.value} mg/dL olarak ölçüldü. Lütfen kontrol edin.`,
                icon: '/favicon.ico'
            });
        } else if (newEntry.value > settings.targetRange.high) {
             new Notification('Yüksek Kan Şekeri Uyarısı', {
                body: `Kan şekeriniz ${newEntry.value} mg/dL olarak ölçüldü. Lütfen kontrol edin.`,
                icon: '/favicon.ico'
            });
        }
    }
  }, [activeProfileId, settings]);
  
  const deleteEntry = useCallback((id: string) => {
    setLogEntries(prevEntries => prevEntries.filter(entry => entry.id !== id));
  }, []);

  const updateSettings = useCallback((newSettings: Partial<UserSettings>) => {
    setProfiles(prevProfiles => 
        prevProfiles.map(p => {
            if (p.id === activeProfileIdRef.current) {
                const updatedSettings = {
                    ...p.settings,
                    ...newSettings,
                    targetRange: {
                        ...p.settings.targetRange,
                        ...(newSettings.targetRange || {}),
                    },
                    notifications: {
                        ...p.settings.notifications,
                        ...(newSettings.notifications || {})
                    },
                    libreLinkUp: {
                        ...p.settings.libreLinkUp,
                        ...(newSettings.libreLinkUp || {})
                    }
                };
                return { ...p, settings: updatedSettings };
            }
            return p;
        })
    );
  }, []);

  const disconnectLibre = useCallback(async () => {
    try {
        await apiDisconnect();
    } catch (error) {
        console.error("Bağlantı kesilirken hata oluştu:", error);
    }
    updateSettings({ libreLinkUp: { ...initialSettings.libreLinkUp, status: 'disconnected' } });
  }, [updateSettings]);

  // Optimized sync function
  const syncLibreData = useCallback(async () => {
      const currentSettings = settingsRef.current;
      // Allow sync if we have a valid session ID in storage (web/mobil/electron hepsi icin ortak)
      if (localStorage.getItem('libreSessionId') === null) return;

      try {
          const readings = await fetchLatestReadings();
          if (!readings || readings.length === 0) return;

          setLogEntries(prevEntries => {
              const existingTimestamps = new Set(prevEntries.map(e => e.timestamp));
              const newEntries: LogEntry[] = [];

              readings.forEach(reading => {
                  if (!existingTimestamps.has(reading.timestamp) && reading.value !== null) {
                      const pid = activeProfileIdRef.current; // Always use Ref for latest ID
                      if (pid) {
                        newEntries.push({
                            id: uuidv4(),
                            profileId: pid,
                            type: EntryType.BloodSugar,
                            value: reading.value!,
                            measurementType: BloodSugarMeasurementType.CGM,
                            timestamp: reading.timestamp,
                            trendArrow: reading.trendArrow
                        });
                      }
                  }
              });

              if (newEntries.length > 0) {
                  return [...prevEntries, ...newEntries].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
              }
              return prevEntries;
          });
          
          const latestReading = readings[0];
          const updates: any = { lastSync: new Date().toISOString() };
          if (latestReading && latestReading.sensor) {
              updates.sensor = latestReading.sensor;
          }
          
          updateSettings({ 
               libreLinkUp: { 
                   ...currentSettings.libreLinkUp,
                   ...updates
               }
           });

      } catch (error: any) {
          console.error("Libre verileri senkronize edilirken hata:", error);
           if (error.message && error.message.includes('Oturum')) {
                disconnectLibre();
           }
      }
  }, [updateSettings, disconnectLibre]); 

  const connectLibre = async (email: string, password: string) => {
    const region = settings.libreLinkUp.region || 'EU';
    
    updateSettings({ libreLinkUp: { ...settings.libreLinkUp, status: 'connecting' } });
    
    try {
        // Increased global timeout slightly to allow retries
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("TIMEOUT")), 75000)
        );

        const result: any = await Promise.race([
            connectToLibre(email, password, region),
            timeoutPromise
        ]);
        
        if (result && result.success) {
            updateSettings({
                libreLinkUp: { ...settings.libreLinkUp, status: 'connected', email: email }
            });
            await syncLibreData();
        } else {
            throw new Error("Bağlantı Başarısız");
        }
    } catch (error: any) {
        console.error("Libre bağlantı hatası:", error);
        
        // Improved Error Extraction
        let errMsg = 'Bilinmeyen Hata';
        if (error instanceof Error) {
            errMsg = error.message;
        } else if (typeof error === 'string') {
            errMsg = error;
        } else if (error && typeof error === 'object') {
            errMsg = error.message || error.error || JSON.stringify(error);
        }
        
        if (String(errMsg) === '[object Object]') {
            errMsg = JSON.stringify(error);
        }

        if (error.name === 'AbortError' || errMsg === "TIMEOUT" || String(errMsg).includes("timeout")) {
             errMsg = "Bağlantı zaman aşımına uğradı. Otomatik olarak Simülasyon Moduna geçiliyor...";
        } else if (String(errMsg).includes('403') || String(errMsg).includes('Giriş başarısız')) {
            errMsg = 'Giriş başarısız. E-posta veya şifre hatalı. Lütfen kontrol edip tekrar deneyin.';
        }

        alert(`Bağlantı Durumu: ${errMsg}`);
        
        // Auto fallback to mock if timeout
        if(localStorage.getItem('libreIsMock') === 'true') {
             updateSettings({ libreLinkUp: { ...settings.libreLinkUp, status: 'connected', email: email } });
             setTimeout(() => syncLibreData(), 1000);
        } else {
             updateSettings({ libreLinkUp: { ...settings.libreLinkUp, status: 'error' } });
        }
    }
  };

  useEffect(() => {
      let interval: ReturnType<typeof setInterval>;
      // İlk açılışta bir kez dene (session yoksa zaten hemen döner)
      syncLibreData();
      interval = setInterval(() => {
          syncLibreData();
      }, 30000); // 30 sn
      return () => {
          if (interval) clearInterval(interval);
      }
  }, [settings.libreLinkUp.status, syncLibreData]);


  const addProfile = useCallback((profileData: Omit<Profile, 'id' | 'settings'>) => {
    const newProfile: Profile = {
        ...profileData,
        id: uuidv4(),
        settings: initialSettings,
    };
    setProfiles(prev => [...prev, newProfile]);
    setActiveProfileId(newProfile.id);
  }, []);

  const updateProfile = useCallback((profileId: string, updates: Partial<Omit<Profile, 'id' | 'settings'>>) => {
      setProfiles(prev => prev.map(p => p.id === profileId ? {...p, ...updates} : p));
  }, []);

  const deleteProfile = useCallback((profileId: string) => {
    if(profiles.length <= 1) {
        alert("En az bir profil kalmalıdır.");
        return;
    }
    if(window.confirm("Bu profili ve ilgili tüm verileri silmek istediğinizden emin misiniz?")){
        setLogEntries(prev => prev.filter(e => e.profileId !== profileId));
        setProfiles(prev => prev.filter(p => p.id !== profileId));
        if (activeProfileId === profileId) {
            setActiveProfileId(profiles.find(p => p.id !== profileId)?.id || null);
        }
    }
  }, [profiles, activeProfileId]);

  const switchProfile = useCallback((profileId: string) => {
      setActiveProfileId(profileId);
  }, []);


  const value = { 
    logEntries: logEntriesForActiveProfile, 
    settings,
    profiles,
    activeProfile,
    addEntry, 
    deleteEntry, 
    updateSettings,
    addProfile,
    updateProfile,
    deleteProfile,
    switchProfile,
    isOnboarding,
    handleOnboardingComplete,
    connectLibre,
    disconnectLibre,
    syncLibreData,
  };

  return <LogDataContext.Provider value={value}>{children}</LogDataContext.Provider>;
};

const AppContent: React.FC = () => {
    const { isOnboarding, handleOnboardingComplete } = useLogData();
    const [activePage, setActivePage] = useState<Page>('dashboard');

    if (isOnboarding === null) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
                <i className="fa-solid fa-spinner fa-spin text-4xl text-blue-500"></i>
            </div>
        );
    }

    if (isOnboarding) {
        return <Onboarding onComplete={handleOnboardingComplete} />;
    }

    const renderPage = () => {
        switch (activePage) {
            case 'dashboard': return <Dashboard />;
            case 'reports': return <Reports />;
            case 'calculator': return <Calculator />;
            case 'settings': return <Settings />;
            default: return <Dashboard />;
        }
    };
    
    return (
        <div className="flex flex-col h-screen font-sans bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-200">
            <Header />
            <main className="flex-grow overflow-y-auto pb-20">
                <div className="container mx-auto p-4">
                    {renderPage()}
                </div>
            </main>
            <BottomNav activePage={activePage} setActivePage={setActivePage} />
        </div>
    );
}


const App: React.FC = () => {
  return (
    <LogDataProvider>
      <AppContent />
    </LogDataProvider>
  );
};

export default App;
