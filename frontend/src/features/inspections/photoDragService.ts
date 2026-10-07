/**
 * Global Photo Drag & Auto-Scroll Service
 *
 * Provides:
 * 1. Global drag state tracking across components (desktop HTML5 drag + mobile touch drag)
 * 2. Smooth auto-scrolling of the window / page when dragging near viewport edges
 * 3. Prevention of dropping into the same question with prominent floating toast alert
 * 4. Mobile touch drag-and-drop with floating ghost preview
 */

export interface DraggedPhotoInfo {
  photoId: string;
  photoUrl?: string;
  fromTarget: string;
  fromSectionId?: string;
  fromResponseId?: string;
  isDefect?: boolean;
}

let activeDraggedPhoto: DraggedPhotoInfo | null = null;
let autoScrollRaf: number | null = null;
let currentScrollSpeed = 0;
let isGlobalListenersAttached = false;
let lastTouchX = 0;
let lastTouchY = 0;

// ── Floating Toast Notification for Drag & Drop ──
export function showDragNotification(message: string, type: 'warning' | 'success' | 'info' = 'info') {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById('ozellar-drag-notification');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'ozellar-drag-notification';
  toast.className = `drag-floating-toast toast-${type}`;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'drag-toast-icon';
  iconSpan.innerHTML =
    type === 'warning'
      ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
      : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  const textSpan = document.createElement('span');
  textSpan.className = 'drag-toast-text';
  textSpan.innerText = message;

  toast.appendChild(iconSpan);
  toast.appendChild(textSpan);
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}

// ── Safe cross-browser scroll helper ──
function doScroll(deltaY: number) {
  const prevY = window.scrollY || document.documentElement.scrollTop || 0;
  try {
    window.scrollBy({ top: deltaY, left: 0, behavior: 'instant' as any });
  } catch {
    window.scrollBy(0, deltaY);
  }
  const nextY = window.scrollY || document.documentElement.scrollTop || 0;
  if (nextY === prevY) {
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop += deltaY;
    } else {
      if (document.documentElement) document.documentElement.scrollTop += deltaY;
      if (document.body) document.body.scrollTop += deltaY;
    }
  }
}

// ── Auto-scroll loop ──
function runAutoScroll() {
  if (currentScrollSpeed !== 0) {
    doScroll(currentScrollSpeed);
    if (activeDraggedPhoto) {
      updateHoveredTargets(lastTouchX, lastTouchY);
    }
    autoScrollRaf = requestAnimationFrame(runAutoScroll);
  } else {
    autoScrollRaf = null;
  }
}

/**
 * Updates auto-scroll speed based on pointer/touch clientY position.
 * Uses a generous 160px–220px threshold so mobile users can easily scroll while dragging.
 */
export function updateDragAutoScroll(clientY: number) {
  const innerHeight = window.innerHeight;
  // Dynamic threshold: 25% of viewport height, minimum 160px for easy mobile triggering
  const threshold = Math.max(160, Math.min(220, Math.round(innerHeight * 0.25)));

  if (clientY < threshold) {
    // Near top: scroll up proportionally
    const intensity = Math.min(1.5, Math.max(0.12, (threshold - clientY) / threshold));
    currentScrollSpeed = -Math.round(intensity * 26) - 5;
  } else if (clientY > innerHeight - threshold) {
    // Near bottom: scroll down proportionally
    const intensity = Math.min(1.5, Math.max(0.12, (clientY - (innerHeight - threshold)) / threshold));
    currentScrollSpeed = Math.round(intensity * 26) + 5;
  } else {
    currentScrollSpeed = 0;
  }

  if (currentScrollSpeed !== 0 && !autoScrollRaf) {
    autoScrollRaf = requestAnimationFrame(runAutoScroll);
  } else if (currentScrollSpeed === 0 && autoScrollRaf) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
  }
}

export function stopDragAutoScroll() {
  currentScrollSpeed = 0;
  if (autoScrollRaf) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
  }
}

type DragEndCallback = () => void;
const dragEndCallbacks = new Set<DragEndCallback>();

export function onPhotoDragEnd(cb: DragEndCallback): () => void {
  dragEndCallbacks.add(cb);
  return () => {
    dragEndCallbacks.delete(cb);
  };
}

// ── HTML5 Drag handlers on window ──
function handleWindowDragOver(e: DragEvent) {
  if (activeDraggedPhoto) {
    updateDragAutoScroll(e.clientY);
  }
}

function handleWindowDragEnd() {
  endPhotoDrag();
}

function attachGlobalDragListeners() {
  if (isGlobalListenersAttached) return;
  isGlobalListenersAttached = true;
  window.addEventListener('dragover', handleWindowDragOver, { passive: true });
  window.addEventListener('dragend', handleWindowDragEnd, { passive: true });
  window.addEventListener('drop', handleWindowDragEnd, { passive: true });
}

function detachGlobalDragListeners() {
  if (!isGlobalListenersAttached) return;
  isGlobalListenersAttached = false;
  window.removeEventListener('dragover', handleWindowDragOver);
  window.removeEventListener('dragend', handleWindowDragEnd);
  window.removeEventListener('drop', handleWindowDragEnd);
}

// Auto-register window-level drag cleanup
if (typeof window !== 'undefined') {
  window.addEventListener('dragend', handleWindowDragEnd, { passive: true });
  window.addEventListener('drop', handleWindowDragEnd, { passive: true });
}

/**
 * Call when starting a drag (HTML5 onDragStart)
 */
export function startPhotoDrag(info: DraggedPhotoInfo) {
  activeDraggedPhoto = info;
  attachGlobalDragListeners();
}

/**
 * Call when ending a drag (HTML5 onDragEnd or onDrop)
 */
export function endPhotoDrag() {
  activeDraggedPhoto = null;
  stopDragAutoScroll();
  detachGlobalDragListeners();

  // Clean up all drag highlight classes anywhere in the DOM
  if (typeof document !== 'undefined') {
    document.querySelectorAll('.drag-over, .drag-same-question, .drag-same-section').forEach((el) => {
      el.classList.remove('drag-over', 'drag-same-question', 'drag-same-section');
    });
  }

  for (const cb of dragEndCallbacks) {
    try {
      cb();
    } catch (err) {
      console.error('Error in dragEndCallback', err);
    }
  }
}

/**
 * Inspect active dragged photo
 */
export function getDraggedPhoto(): DraggedPhotoInfo | null {
  return activeDraggedPhoto;
}

/**
 * Check if the active dragged photo belongs to this question
 */
export function isPhotoFromQuestion(responseId?: string | null): boolean {
  if (!activeDraggedPhoto || !activeDraggedPhoto.fromResponseId || !responseId) {
    return false;
  }
  return activeDraggedPhoto.fromResponseId === responseId;
}

// ── Mobile Touch Drag Support ──
export interface TouchDragHandlers {
  onDropToQuestion: (photoId: string, questionId: string, sectionId?: string) => Promise<void> | void;
  onDropToSection?: (photoId: string, sectionId: string) => Promise<void> | void;
  onSameQuestionAttempt?: () => void;
  onSameSectionAttempt?: () => void;
  onReleaseWithoutDrag?: () => void;
}

let activeGhostElement: HTMLElement | null = null;
let currentHoveredCard: HTMLElement | null = null;
let currentHoveredSectionCard: HTMLElement | null = null;

function updateHoveredTargets(clientX: number, clientY: number) {
  if (!activeDraggedPhoto) return;

  const elUnder = document.elementFromPoint(clientX, clientY);
  const card = elUnder?.closest('[data-question-card-id]') as HTMLElement | null;
  const sectionCard = !card ? (elUnder?.closest('[data-section-photos-drop]') as HTMLElement | null) : null;

  // Question card hover
  if (card !== currentHoveredCard) {
    if (currentHoveredCard) {
      currentHoveredCard.classList.remove('drag-over', 'drag-same-question');
    }
    currentHoveredCard = card;
    if (currentHoveredCard) {
      const cardRespId = currentHoveredCard.getAttribute('data-response-id');
      const isSame = !!activeDraggedPhoto.fromResponseId && cardRespId === activeDraggedPhoto.fromResponseId;
      if (isSame) {
        currentHoveredCard.classList.add('drag-same-question');
        if (activeGhostElement) {
          activeGhostElement.classList.add('same-question');
          const b = activeGhostElement.querySelector('.touch-drag-ghost-badge');
          if (b) b.textContent = 'Same Question';
        }
      } else {
        currentHoveredCard.classList.add('drag-over');
        if (activeGhostElement) {
          activeGhostElement.classList.remove('same-question');
          const b = activeGhostElement.querySelector('.touch-drag-ghost-badge');
          if (b) b.textContent = 'Drop here';
        }
      }
    }
  }

  // Section photos card hover
  if (sectionCard !== currentHoveredSectionCard) {
    if (currentHoveredSectionCard) {
      currentHoveredSectionCard.classList.remove('drag-over', 'drag-same-section');
    }
    currentHoveredSectionCard = sectionCard;
    if (currentHoveredSectionCard) {
      const targetSecId = currentHoveredSectionCard.getAttribute('data-section-id');
      const isSame =
        activeDraggedPhoto.fromTarget === 'section' && (!targetSecId || targetSecId === activeDraggedPhoto.fromSectionId);
      if (isSame) {
        currentHoveredSectionCard.classList.add('drag-same-section');
        if (activeGhostElement) {
          activeGhostElement.classList.add('same-question');
          const b = activeGhostElement.querySelector('.touch-drag-ghost-badge');
          if (b) b.textContent = 'Same Section';
        }
      } else {
        currentHoveredSectionCard.classList.add('drag-over');
        if (activeGhostElement) {
          activeGhostElement.classList.remove('same-question');
          const b = activeGhostElement.querySelector('.touch-drag-ghost-badge');
          if (b) b.textContent = 'To Section';
        }
      }
    }
  }

  if (!currentHoveredCard && !currentHoveredSectionCard && activeGhostElement) {
    activeGhostElement.classList.remove('same-question');
    const b = activeGhostElement.querySelector('.touch-drag-ghost-badge');
    if (b) b.textContent = activeDraggedPhoto.isDefect ? 'Defect' : 'Photo';
  }
}

export function startTouchPhotoDrag(
  startCoord: { clientX: number; clientY: number },
  info: DraggedPhotoInfo,
  handlers: TouchDragHandlers,
  sourceElement?: HTMLElement | null
) {
  const startX = startCoord.clientX;
  const startY = startCoord.clientY;
  lastTouchX = startX;
  lastTouchY = startY;
  let maxMovement = 0;

  activeDraggedPhoto = info;

  if (sourceElement) {
    sourceElement.classList.add('is-held-drag');
  }

  // Create floating ghost element
  const ghost = document.createElement('div');
  ghost.className = `touch-drag-ghost${info.isDefect ? ' is-defect' : ''}`;
  ghost.style.left = `${startX}px`;
  ghost.style.top = `${startY}px`;

  if (info.photoUrl) {
    const img = document.createElement('img');
    img.src = info.photoUrl;
    img.className = 'touch-drag-ghost-img';
    ghost.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'touch-drag-ghost-placeholder';
    placeholder.innerText = '📷';
    ghost.appendChild(placeholder);
  }

  const badge = document.createElement('div');
  badge.className = 'touch-drag-ghost-badge';
  badge.innerText = info.isDefect ? 'Defect' : 'Photo';
  ghost.appendChild(badge);

  document.body.appendChild(ghost);
  activeGhostElement = ghost;

  // Haptic feedback if available
  try {
    if (navigator.vibrate) navigator.vibrate(40);
  } catch {}

  function onTouchMove(moveEvent: TouchEvent) {
    const moveTouch = moveEvent.touches[0];
    if (!moveTouch) return;

    lastTouchX = moveTouch.clientX;
    lastTouchY = moveTouch.clientY;

    const moveDist = Math.hypot(moveTouch.clientX - startX, moveTouch.clientY - startY);
    if (moveDist > maxMovement) maxMovement = moveDist;

    // Prevent default screen scrolling during touch drag
    if (moveEvent.cancelable) {
      moveEvent.preventDefault();
    }

    // Move ghost with finger
    if (activeGhostElement) {
      activeGhostElement.style.left = `${moveTouch.clientX}px`;
      activeGhostElement.style.top = `${moveTouch.clientY}px`;
    }

    // Auto-scroll window when near edges
    updateDragAutoScroll(moveTouch.clientY);

    // Identify drop target card under finger
    updateHoveredTargets(moveTouch.clientX, moveTouch.clientY);
  }

  async function onTouchEnd(_endEvent: TouchEvent) {
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);

    stopDragAutoScroll();

    if (sourceElement) {
      sourceElement.classList.remove('is-held-drag');
    }

    if (activeGhostElement) {
      activeGhostElement.remove();
      activeGhostElement = null;
    }

    // If held in place and released without dragging (maxMovement < 15px)
    if (maxMovement < 15 && handlers.onReleaseWithoutDrag) {
      handlers.onReleaseWithoutDrag();
      if (currentHoveredCard) {
        currentHoveredCard.classList.remove('drag-over', 'drag-same-question');
        currentHoveredCard = null;
      }
      if (currentHoveredSectionCard) {
        currentHoveredSectionCard.classList.remove('drag-over', 'drag-same-section');
        currentHoveredSectionCard = null;
      }
      endPhotoDrag();
      return;
    }

    // Drop onto a Question Card
    if (currentHoveredCard) {
      const qId = currentHoveredCard.getAttribute('data-question-card-id');
      const cardRespId = currentHoveredCard.getAttribute('data-response-id');
      const isSame = !!info.fromResponseId && cardRespId === info.fromResponseId;

      currentHoveredCard.classList.remove('drag-over', 'drag-same-question');
      currentHoveredCard = null;

      if (isSame) {
        try {
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
        } catch {}
        showDragNotification('Photo is already attached to this question', 'warning');
        if (handlers.onSameQuestionAttempt) {
          handlers.onSameQuestionAttempt();
        }
      } else if (qId) {
        try {
          if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        } catch {}
        try {
          await handlers.onDropToQuestion(info.photoId, qId, info.fromSectionId);
          showDragNotification('Photo assigned to question', 'success');
        } catch (err) {
          console.error('Failed to drop photo via touch drag', err);
        }
      }
    } else if (currentHoveredSectionCard) {
      // Drop onto Section Photos Card
      const targetSecId = currentHoveredSectionCard.getAttribute('data-section-id') || '';
      const isSame = info.fromTarget === 'section' && (!targetSecId || targetSecId === info.fromSectionId);

      currentHoveredSectionCard.classList.remove('drag-over', 'drag-same-section');
      currentHoveredSectionCard = null;

      if (isSame) {
        try {
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
        } catch {}
        showDragNotification('Photo is already in section photos', 'warning');
        if (handlers.onSameSectionAttempt) {
          handlers.onSameSectionAttempt();
        }
      } else if (handlers.onDropToSection) {
        try {
          if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        } catch {}
        try {
          await handlers.onDropToSection(info.photoId, targetSecId);
          showDragNotification('Photo moved to section photos', 'success');
        } catch (err) {
          console.error('Failed to drop photo to section via touch drag', err);
        }
      }
    }

    endPhotoDrag();
  }

  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: false });
  window.addEventListener('touchcancel', onTouchEnd, { passive: false });
}
