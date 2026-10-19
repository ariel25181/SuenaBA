import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  UserRole,
  VenueProfile,
  MusicianProfile,
  VenueOpenCall,
  MusicianAvailability,
  LiveShowConfirmed,
  Review,
  Application,
  DirectOffer,
  MusicGenre,
  NeighborhoodBA,
} from '../types/index.ts';
import {
  INITIAL_VENUES,
  INITIAL_MUSICIANS,
  INITIAL_OPEN_CALLS,
  INITIAL_MUSICIAN_AVAILABILITIES,
  INITIAL_LIVE_SHOWS,
} from '../data/seedData.ts';
import { calculateNewRating, calculateNewBreakdown } from '../utils/bookingLogic.ts';
import { supabase } from '../lib/supabaseClient.ts';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'application' | 'offer' | 'confirmed' | 'review';
}

interface AppContextType {
  role: UserRole;
  setRole: (role: UserRole) => void;
  activeMusicianId: string;
  setActiveMusicianId: (id: string) => void;
  activeVenueId: string;
  setActiveVenueId: (id: string) => void;

  venues: VenueProfile[];
  musicians: MusicianProfile[];
  openCalls: VenueOpenCall[];
  musicianAvailabilities: MusicianAvailability[];
  liveShows: LiveShowConfirmed[];
  notifications: NotificationItem[];

  currentMusician: MusicianProfile | undefined;
  currentVenue: VenueProfile | undefined;

  // Actions
  publishOpenCall: (callData: Omit<VenueOpenCall, 'id' | 'applications' | 'createdAt' | 'status'>) => void;
  applyToOpenCall: (callId: string, application: Omit<Application, 'id' | 'callId' | 'status' | 'createdAt'>) => void;
  acceptApplication: (callId: string, applicationId: string) => void;
  rejectApplication: (callId: string, applicationId: string) => void;

  publishAvailability: (availData: Omit<MusicianAvailability, 'id' | 'directOffers' | 'createdAt' | 'status'>) => void;
  sendDirectOffer: (availabilityId: string, offer: Omit<DirectOffer, 'id' | 'availabilityId' | 'status' | 'createdAt'>) => void;
  acceptDirectOffer: (availabilityId: string, offerId: string) => void;
  rejectDirectOffer: (availabilityId: string, offerId: string) => void;

  submitReview: (reviewData: Omit<Review, 'id' | 'createdAt'>, showIdToComplete?: string) => void;
  markNotificationsAsRead: () => void;
  resetAllData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY_PREFIX = 'suena_ba_v1_';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRole] = useState<UserRole>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}role`);
    return (saved as UserRole) || 'musico';
  });

  const [activeMusicianId, setActiveMusicianId] = useState<string>(() => {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}activeMusicianId`) || 'mus-1';
  });

  const [activeVenueId, setActiveVenueId] = useState<string>(() => {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}activeVenueId`) || 'venue-1';
  });

  const [venues, setVenues] = useState<VenueProfile[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}venues`);
    return saved ? JSON.parse(saved) : INITIAL_VENUES;
  });

  const [musicians, setMusicians] = useState<MusicianProfile[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}musicians`);
    return saved ? JSON.parse(saved) : INITIAL_MUSICIANS;
  });

  const [openCalls, setOpenCalls] = useState<VenueOpenCall[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}openCalls`);
    return saved ? JSON.parse(saved) : INITIAL_OPEN_CALLS;
  });

  const [musicianAvailabilities, setMusicianAvailabilities] = useState<MusicianAvailability[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}availabilities`);
    return saved ? JSON.parse(saved) : INITIAL_MUSICIAN_AVAILABILITIES;
  });

  const [liveShows, setLiveShows] = useState<LiveShowConfirmed[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}liveShows`);
    return saved ? JSON.parse(saved) : INITIAL_LIVE_SHOWS;
  });

  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}notifications`);
    if (saved) return JSON.parse(saved);
    return [
      {
        id: 'notif-1',
        title: '¡Nueva postulación recibida!',
        message: 'Julieta Díaz & Trío Nocturno se postuló para tu fecha del 24 de Octubre en Thelonious Club.',
        timestamp: 'Hace 2 horas',
        read: false,
        type: 'application',
      },
      {
        id: 'notif-2',
        title: '¡Propuesta directa de fecha!',
        message: 'Bebop Subterráneo te envió una oferta para tocar el 24 de Octubre.',
        timestamp: 'Hace 4 horas',
        read: false,
        type: 'offer',
      },
    ];
  });

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}role`, role);
  }, [role]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}activeMusicianId`, activeMusicianId);
  }, [activeMusicianId]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}activeVenueId`, activeVenueId);
  }, [activeVenueId]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}venues`, JSON.stringify(venues));
  }, [venues]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}musicians`, JSON.stringify(musicians));
  }, [musicians]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}openCalls`, JSON.stringify(openCalls));
  }, [openCalls]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}availabilities`, JSON.stringify(musicianAvailabilities));
  }, [musicianAvailabilities]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}liveShows`, JSON.stringify(liveShows));
  }, [liveShows]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}notifications`, JSON.stringify(notifications));
  }, [notifications]);

  // Synchronize with Supabase Cloud Database
  useEffect(() => {
    async function syncWithSupabase() {
      if (!supabase) return;
      try {
        const { data: vData } = await supabase.from('venues').select('*');
        if (vData && vData.length > 0) {
          setVenues(vData);
        }

        const { data: mData } = await supabase.from('musicians').select('*');
        if (mData && mData.length > 0) {
          setMusicians(mData);
        }

        const { data: cData } = await supabase.from('open_calls').select('*');
        if (cData && cData.length > 0) {
          setOpenCalls(cData);
        }

        const { data: aData } = await supabase.from('musician_availabilities').select('*');
        if (aData && aData.length > 0) {
          setMusicianAvailabilities(aData);
        }

        const { data: sData } = await supabase.from('live_shows').select('*');
        if (sData && sData.length > 0) {
          setLiveShows(sData);
        }
      } catch {
        // Fallback to local storage if offline or tables not yet migrated
      }
    }
    syncWithSupabase();
  }, []);

  const currentMusician = musicians.find((m) => m.id === activeMusicianId) || musicians[0];
  const currentVenue = venues.find((v) => v.id === activeVenueId) || venues[0];

  const publishOpenCall = (callData: Omit<VenueOpenCall, 'id' | 'applications' | 'createdAt' | 'status'>) => {
    const newCall: VenueOpenCall = {
      ...callData,
      id: `call-${Date.now()}`,
      status: 'abierta',
      applications: [],
      createdAt: new Date().toISOString().split('T')[0],
    };
    setOpenCalls((prev) => [newCall, ...prev]);

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: 'Convocatoria publicada con éxito',
        message: `Tu fecha para el ${newCall.date} ya está visible para los músicos de Buenos Aires.`,
        timestamp: 'Recién',
        read: false,
        type: 'application',
      },
      ...prev,
    ]);
  };

  const applyToOpenCall = (callId: string, applicationData: Omit<Application, 'id' | 'callId' | 'status' | 'createdAt'>) => {
    const newApp: Application = {
      ...applicationData,
      id: `app-${Date.now()}`,
      callId,
      status: 'pendiente',
      createdAt: new Date().toISOString().split('T')[0],
    };

    setOpenCalls((prev) =>
      prev.map((c) => {
        if (c.id === callId) {
          return {
            ...c,
            applications: [newApp, ...c.applications],
          };
        }
        return c;
      })
    );

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: '¡Postulación enviada!',
        message: `Te postulaste a la fecha en ${applicationData.musicianName}. El bar revisará tu propuesta.`,
        timestamp: 'Recién',
        read: false,
        type: 'application',
      },
      ...prev,
    ]);
  };

  const acceptApplication = (callId: string, applicationId: string) => {
    let acceptedMusicianId = '';
    let targetCall: VenueOpenCall | undefined;

    setOpenCalls((prev) =>
      prev.map((call) => {
        if (call.id === callId) {
          targetCall = call;
          const updatedApps = call.applications.map((app) => {
            if (app.id === applicationId) {
              acceptedMusicianId = app.musicianId;
              return { ...app, status: 'aceptada' as const };
            }
            return { ...app, status: 'rechazada' as const };
          });
          const acceptedApp = updatedApps.find((a) => a.id === applicationId);
          return {
            ...call,
            status: 'cerrada_confirmada' as const,
            confirmedMusicianId: acceptedMusicianId,
            confirmedMusicianName: acceptedApp?.musicianName,
            applications: updatedApps,
          };
        }
        return call;
      })
    );

    if (targetCall) {
      const musician = musicians.find((m) => m.id === acceptedMusicianId);
      const venue = venues.find((v) => v.id === targetCall?.venueId);

      if (musician && venue) {
        // Create confirmed live show on public catalog
        const newShow: LiveShowConfirmed = {
          id: `show-${Date.now()}`,
          date: targetCall.date,
          time: targetCall.showTime.split(' ')[0] + ' hs',
          venueId: venue.id,
          venueName: venue.name,
          venueAddress: venue.address,
          venueNeighborhood: venue.neighborhood,
          venuePhoto: venue.coverPhoto,
          musicianId: musician.id,
          musicianName: musician.stageName,
          musicianGenres: musician.genres,
          musicianFormat: musician.format,
          musicianAvatar: musician.avatarUrl,
          ticketType: 'consumicion_minima',
          ticketPriceARS: 7000,
          description: `Show en vivo confirmado a través de SuenaBA. ${targetCall.specialNotes}`,
          isCompleted: false,
          venueReviewed: false,
          musicianReviewed: false,
        };

        setLiveShows((prev) => [newShow, ...prev]);

        setNotifications((prev) => [
          {
            id: `notif-${Date.now()}`,
            title: '🎉 ¡Acuerdo Confirmado & Show Publicado!',
            message: `La fecha del ${targetCall?.date} en ${venue.name} con ${musician.stageName} ya está en la cartelera de Buenos Aires.`,
            timestamp: 'Recién',
            read: false,
            type: 'confirmed',
          },
          ...prev,
        ]);
      }
    }
  };

  const rejectApplication = (callId: string, applicationId: string) => {
    setOpenCalls((prev) =>
      prev.map((call) => {
        if (call.id === callId) {
          return {
            ...call,
            applications: call.applications.map((app) =>
              app.id === applicationId ? { ...app, status: 'rechazada' as const } : app
            ),
          };
        }
        return call;
      })
    );
  };

  const publishAvailability = (availData: Omit<MusicianAvailability, 'id' | 'directOffers' | 'createdAt' | 'status'>) => {
    const newAvail: MusicianAvailability = {
      ...availData,
      id: `avail-${Date.now()}`,
      status: 'disponible',
      directOffers: [],
      createdAt: new Date().toISOString().split('T')[0],
    };
    setMusicianAvailabilities((prev) => [newAvail, ...prev]);

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: 'Disponibilidad publicada',
        message: `Bares y restaurantes de CABA ya pueden ver tu fecha libre del ${newAvail.date}.`,
        timestamp: 'Recién',
        read: false,
        type: 'offer',
      },
      ...prev,
    ]);
  };

  const sendDirectOffer = (availabilityId: string, offerData: Omit<DirectOffer, 'id' | 'availabilityId' | 'status' | 'createdAt'>) => {
    const newOffer: DirectOffer = {
      ...offerData,
      id: `offer-${Date.now()}`,
      availabilityId,
      status: 'pendiente',
      createdAt: new Date().toISOString().split('T')[0],
    };

    setMusicianAvailabilities((prev) =>
      prev.map((item) => {
        if (item.id === availabilityId) {
          return {
            ...item,
            directOffers: [newOffer, ...item.directOffers],
          };
        }
        return item;
      })
    );

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: '¡Oferta enviada al músico!',
        message: `Enviaste una propuesta a ${offerData.venueName} para la fecha indicada.`,
        timestamp: 'Recién',
        read: false,
        type: 'offer',
      },
      ...prev,
    ]);
  };

  const acceptDirectOffer = (availabilityId: string, offerId: string) => {
    let acceptedOffer: DirectOffer | undefined;
    let targetAvail: MusicianAvailability | undefined;

    setMusicianAvailabilities((prev) =>
      prev.map((item) => {
        if (item.id === availabilityId) {
          targetAvail = item;
          const updatedOffers = item.directOffers.map((o) => {
            if (o.id === offerId) {
              acceptedOffer = o;
              return { ...o, status: 'aceptada' as const };
            }
            return { ...o, status: 'rechazada' as const };
          });
          return {
            ...item,
            status: 'reservado' as const,
            directOffers: updatedOffers,
          };
        }
        return item;
      })
    );

    if (acceptedOffer && targetAvail) {
      const musician = musicians.find((m) => m.id === targetAvail?.musicianId);
      const venue = venues.find((v) => v.id === acceptedOffer?.venueId);

      if (musician && venue) {
        const newShow: LiveShowConfirmed = {
          id: `show-${Date.now()}`,
          date: acceptedOffer.date,
          time: '21:30 hs',
          venueId: venue.id,
          venueName: venue.name,
          venueAddress: venue.address,
          venueNeighborhood: venue.neighborhood,
          venuePhoto: venue.coverPhoto,
          musicianId: musician.id,
          musicianName: musician.stageName,
          musicianGenres: musician.genres,
          musicianFormat: musician.format,
          musicianAvatar: musician.avatarUrl,
          ticketType: 'entrada_libre',
          ticketPriceARS: 0,
          description: `Acuerdo directo concretado en SuenaBA. ¡Música en vivo en ${venue.neighborhood}!`,
          isCompleted: false,
          venueReviewed: false,
          musicianReviewed: false,
        };

        setLiveShows((prev) => [newShow, ...prev]);

        setNotifications((prev) => [
          {
            id: `notif-${Date.now()}`,
            title: '🎉 ¡Oferta Aceptada!',
            message: `Acordaste fecha para el ${acceptedOffer?.date} en ${venue.name}. Se sumó a la cartelera.`,
            timestamp: 'Recién',
            read: false,
            type: 'confirmed',
          },
          ...prev,
        ]);
      }
    }
  };

  const rejectDirectOffer = (availabilityId: string, offerId: string) => {
    setMusicianAvailabilities((prev) =>
      prev.map((item) => {
        if (item.id === availabilityId) {
          return {
            ...item,
            directOffers: item.directOffers.map((o) =>
              o.id === offerId ? { ...o, status: 'rechazada' as const } : o
            ),
          };
        }
        return item;
      })
    );
  };

  const submitReview = (reviewData: Omit<Review, 'id' | 'createdAt'>, showIdToComplete?: string) => {
    const newReview: Review = {
      ...reviewData,
      id: `rev-${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0],
    };

    if (reviewData.targetType === 'venue') {
      setVenues((prev) =>
        prev.map((v) => {
          if (v.id === reviewData.targetId) {
            const { rating, count } = calculateNewRating(v.rating, v.reviewCount, reviewData.rating);
            const breakdown = calculateNewBreakdown(v.ratingBreakdown, v.reviewCount, reviewData.criteriaBreakdown);
            return {
              ...v,
              rating,
              reviewCount: count,
              ratingBreakdown: breakdown as any,
              reviews: [newReview, ...v.reviews],
            };
          }
          return v;
        })
      );
    } else {
      setMusicians((prev) =>
        prev.map((m) => {
          if (m.id === reviewData.targetId) {
            const { rating, count } = calculateNewRating(m.rating, m.reviewCount, reviewData.rating);
            const breakdown = calculateNewBreakdown(m.ratingBreakdown, m.reviewCount, reviewData.criteriaBreakdown);
            return {
              ...m,
              rating,
              reviewCount: count,
              ratingBreakdown: breakdown as any,
              reviews: [newReview, ...m.reviews],
            };
          }
          return m;
        })
      );
    }

    if (showIdToComplete) {
      setLiveShows((prev) =>
        prev.map((s) => {
          if (s.id === showIdToComplete) {
            if (reviewData.authorType === 'musician') {
              return { ...s, venueReviewed: true };
            } else {
              return { ...s, musicianReviewed: true };
            }
          }
          return s;
        })
      );
    }

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: '⭐ ¡Reseña bilateral publicada!',
        message: `Calificaste a ${reviewData.targetType === 'venue' ? 'el bar' : 'el músico'} con ${reviewData.rating} estrellas. Su reputación fue actualizada.`,
        timestamp: 'Recién',
        read: false,
        type: 'review',
      },
      ...prev,
    ]);
  };

  const markNotificationsAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const resetAllData = () => {
    localStorage.clear();
    setRole('musico');
    setActiveMusicianId('mus-1');
    setActiveVenueId('venue-1');
    setVenues(INITIAL_VENUES);
    setMusicians(INITIAL_MUSICIANS);
    setOpenCalls(INITIAL_OPEN_CALLS);
    setMusicianAvailabilities(INITIAL_MUSICIAN_AVAILABILITIES);
    setLiveShows(INITIAL_LIVE_SHOWS);
    setNotifications([
      {
        id: 'notif-1',
        title: '¡Nueva postulación recibida!',
        message: 'Julieta Díaz & Trío Nocturno se postuló para tu fecha del 24 de Octubre en Thelonious Club.',
        timestamp: 'Hace 2 horas',
        read: false,
        type: 'application',
      },
    ]);
  };

  return (
    <AppContext.Provider
      value={{
        role,
        setRole,
        activeMusicianId,
        setActiveMusicianId,
        activeVenueId,
        setActiveVenueId,
        venues,
        musicians,
        openCalls,
        musicianAvailabilities,
        liveShows,
        notifications,
        currentMusician,
        currentVenue,
        publishOpenCall,
        applyToOpenCall,
        acceptApplication,
        rejectApplication,
        publishAvailability,
        sendDirectOffer,
        acceptDirectOffer,
        rejectDirectOffer,
        submitReview,
        markNotificationsAsRead,
        resetAllData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
