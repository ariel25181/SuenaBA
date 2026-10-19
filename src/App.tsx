import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext.tsx';
import { Header } from './components/Header.tsx';
import { BottomNav } from './components/BottomNav.tsx';
import { CatalogView } from './components/CatalogView.tsx';
import { OpenCallsView } from './components/OpenCallsView.tsx';
import { MusicianAvailabilityView } from './components/MusicianAvailabilityView.tsx';
import { AgreementsAndReviewsView } from './components/AgreementsAndReviewsView.tsx';
import { ProfileView } from './components/ProfileView.tsx';

// Modals
import { ApplyModal } from './components/modals/ApplyModal.tsx';
import { PublishOpenCallModal } from './components/modals/PublishOpenCallModal.tsx';
import { PublishAvailabilityModal } from './components/modals/PublishAvailabilityModal.tsx';
import { DirectOfferModal } from './components/modals/DirectOfferModal.tsx';
import { ShowDetailModal } from './components/modals/ShowDetailModal.tsx';
import { ReviewModal } from './components/modals/ReviewModal.tsx';
import { NotificationsDrawer } from './components/modals/NotificationsDrawer.tsx';
import { PWAInstallBanner } from './components/PWAInstallBanner.tsx';

import { VenueOpenCall, MusicianAvailability, LiveShowConfirmed } from './types/index.ts';
import { Wifi, Battery, Signal, Sparkles } from 'lucide-react';

function MainApp() {
  const { role, currentMusician, currentVenue } = useApp();

  // Navigation tab
  const [activeTab, setActiveTab] = useState<string>('cartelera');

  // Mobile frame simulator toggle
  const [isMobileFrame, setIsMobileFrame] = useState<boolean>(false);

  // Modals state
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [selectedCallForApply, setSelectedCallForApply] = useState<VenueOpenCall | null>(null);

  const [isPublishCallModalOpen, setIsPublishCallModalOpen] = useState(false);
  const [isPublishAvailModalOpen, setIsPublishAvailModalOpen] = useState(false);

  const [isDirectOfferModalOpen, setIsDirectOfferModalOpen] = useState(false);
  const [selectedAvailForOffer, setSelectedAvailForOffer] = useState<MusicianAvailability | null>(null);

  const [isShowDetailModalOpen, setIsShowDetailModalOpen] = useState(false);
  const [selectedShow, setSelectedShow] = useState<LiveShowConfirmed | null>(null);

  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [reviewModalParams, setReviewModalParams] = useState<{
    targetType: 'musician' | 'venue';
    targetId: string;
    targetName: string;
    showDate: string;
    showVenueName: string;
    showIdToComplete?: string;
  }>({
    targetType: 'venue',
    targetId: '',
    targetName: '',
    showDate: '',
    showVenueName: '',
  });

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  // Specific profile viewing target (when clicking from catalog/calls)
  const [viewingTarget, setViewingTarget] = useState<{
    type: 'musician' | 'venue';
    id: string;
  } | null>(null);

  const handleOpenApplyModal = (call: VenueOpenCall) => {
    setSelectedCallForApply(call);
    setIsApplyModalOpen(true);
  };

  const handleOpenDirectOfferModal = (avail: MusicianAvailability) => {
    setSelectedAvailForOffer(avail);
    setIsDirectOfferModalOpen(true);
  };

  const handleSelectShow = (show: LiveShowConfirmed) => {
    setSelectedShow(show);
    setIsShowDetailModalOpen(true);
  };

  const handleOpenReviewModal = (params: typeof reviewModalParams) => {
    setReviewModalParams(params);
    setIsReviewModalOpen(true);
  };

  const handleViewVenueProfile = (venueId: string) => {
    setViewingTarget({ type: 'venue', id: venueId });
    setActiveTab('perfil');
  };

  const handleViewMusicianProfile = (musicianId: string) => {
    setViewingTarget({ type: 'musician', id: musicianId });
    setActiveTab('perfil');
  };

  const handleClearViewingTarget = () => {
    setViewingTarget(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-start items-center p-0 md:p-4 selection:bg-amber-500 selection:text-slate-950 font-sans">
      {/* Device frame container or responsive container */}
      <div
        className={`w-full transition-all duration-300 flex flex-col min-h-screen ${
          isMobileFrame
            ? 'max-w-[420px] rounded-[44px] border-[10px] border-slate-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden my-auto'
            : 'max-w-xl sm:border sm:border-slate-800/80 sm:rounded-3xl sm:my-3 sm:shadow-2xl'
        } bg-slate-950`}
      >
        {/* Simulated Mobile Status Bar (Visible in frame mode or at top) */}
        {isMobileFrame && (
          <div className="px-6 pt-3 pb-1 flex items-center justify-between text-xs text-slate-400 bg-slate-950 z-50 select-none">
            <span className="font-semibold text-slate-200">21:42</span>
            {/* Dynamic Island / Speaker notch */}
            <div className="w-24 h-4 bg-slate-900 rounded-full border border-slate-800" />
            <div className="flex items-center space-x-1.5">
              <Signal className="w-3.5 h-3.5" />
              <Wifi className="w-3.5 h-3.5" />
              <Battery className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
        )}

        {/* Global Sticky Header with Role Switcher */}
        <Header
          isMobileFrame={isMobileFrame}
          setIsMobileFrame={setIsMobileFrame}
          onOpenNotifications={() => setIsNotificationsOpen(true)}
          onSelectTab={setActiveTab}
        />

        {/* PWA In-App Install Prompt Banner */}
        <PWAInstallBanner />

        {/* Current Active Role Badge bar */}
        <div className="bg-slate-900/60 border-b border-slate-800/60 px-4 py-1.5 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center space-x-1.5 truncate">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span>Operando como:</span>
            <strong className="text-slate-200 truncate">
              {role === 'musico'
                ? currentMusician?.stageName
                : role === 'bar'
                ? currentVenue?.name
                : 'Público General en Buenos Aires'}
            </strong>
          </div>
          <button
            onClick={() => {
              setActiveTab('perfil');
              setViewingTarget(null);
            }}
            className="text-amber-400 hover:text-amber-300 font-semibold shrink-0 ml-2"
          >
            {role === 'musico' ? 'Mi Perfil' : role === 'bar' ? 'Mi Bar' : 'Ver'}
          </button>
        </div>

        {/* Main Tab Content View */}
        <main className="flex-1 p-4 overflow-y-auto">
          {activeTab === 'cartelera' && (
            <CatalogView
              onSelectShow={handleSelectShow}
              onViewVenue={handleViewVenueProfile}
              onViewMusician={handleViewMusicianProfile}
            />
          )}

          {activeTab === 'convocatorias' && (
            <OpenCallsView
              onOpenPublishModal={() => setIsPublishCallModalOpen(true)}
              onOpenApplyModal={handleOpenApplyModal}
              onViewVenue={handleViewVenueProfile}
              onViewMusician={handleViewMusicianProfile}
            />
          )}

          {activeTab === 'disponibilidad' && (
            <MusicianAvailabilityView
              onOpenPublishModal={() => setIsPublishAvailModalOpen(true)}
              onOpenDirectOfferModal={handleOpenDirectOfferModal}
              onViewMusician={handleViewMusicianProfile}
              onViewVenue={handleViewVenueProfile}
            />
          )}

          {activeTab === 'acuerdos' && (
            <AgreementsAndReviewsView
              onOpenReviewModal={handleOpenReviewModal}
              onViewVenue={handleViewVenueProfile}
              onViewMusician={handleViewMusicianProfile}
            />
          )}

          {activeTab === 'perfil' && (
            <ProfileView
              viewingTarget={viewingTarget}
              onClearTarget={handleClearViewingTarget}
              onOpenReviewModal={handleOpenReviewModal}
            />
          )}
        </main>

        {/* Fixed Mobile Bottom Navigation */}
        <BottomNav activeTab={activeTab} onSelectTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'perfil') {
            setViewingTarget(null);
          }
        }} />
      </div>

      {/* Modals */}
      <ApplyModal
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        openCall={selectedCallForApply}
      />

      <PublishOpenCallModal
        isOpen={isPublishCallModalOpen}
        onClose={() => setIsPublishCallModalOpen(false)}
      />

      <PublishAvailabilityModal
        isOpen={isPublishAvailModalOpen}
        onClose={() => setIsPublishAvailModalOpen(false)}
      />

      <DirectOfferModal
        isOpen={isDirectOfferModalOpen}
        onClose={() => setIsDirectOfferModalOpen(false)}
        availability={selectedAvailForOffer}
      />

      <ShowDetailModal
        isOpen={isShowDetailModalOpen}
        onClose={() => setIsShowDetailModalOpen(false)}
        show={selectedShow}
        onViewVenueProfile={handleViewVenueProfile}
        onViewMusicianProfile={handleViewMusicianProfile}
      />

      <ReviewModal
        isOpen={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        targetType={reviewModalParams.targetType}
        targetId={reviewModalParams.targetId}
        targetName={reviewModalParams.targetName}
        showDate={reviewModalParams.showDate}
        showVenueName={reviewModalParams.showVenueName}
        showIdToComplete={reviewModalParams.showIdToComplete}
      />

      <NotificationsDrawer
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        onNavigateToTab={setActiveTab}
      />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
}
