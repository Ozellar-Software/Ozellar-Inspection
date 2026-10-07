/**
 * Global Photo Drag & Auto-Scroll Service
 *
 * Provides:
 * 1. Global drag state tracking across components (desktop HTML5 drag + mobile touch drag)
 * 2. Smooth auto-scrolling of the window / page when dragging near viewport edges
 * 3. Prevention of dropping into the same question
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

// ── Auto-scroll loop ──
function runAutoScroll() {
  if (currentScrollSpeed !== 0) {
    window.scrollBy(0, currentScrollSpeed);
    autoScrollRaf = requestAnimationFrame(runAutoScroll);
  } else {
    autoScrollRaf = null;
  }
}

/**
 * Updates auto-scroll speed based on pointer/touch clientY position.
 * When clientY is within top/bottom threshold (100px), smoothly scrolls the window.
 */
export function updateDragAutoScroll(clientY: number) {
  const threshold = 100;
  const innerHeight = window.innerHeight;

  if (clientY < threshold) {
    // Near top: scroll up proportionally
    const intensity = Math.max(0, (threshold - clientY) / threshold);
    currentScrollSpeed = -Math.round(intensity * 22) - 4;
  } else if (clientY > innerHeight - threshold) {
    // Near bottom: scroll down proportionally
    const intensity = Math.max(0, (clientY - (innerHeight - threshold)) / threshold);
    currentScrollSpeed = Math.round(intensity * 22) + 4;
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

export function startTouchPhotoDrag(
  startCoord: { clientX: number; clientY: number },
  info: DraggedPhotoInfo,
  handlers: TouchDragHandlers,
  sourceElement?: HTMLElement | null
) {
  const startX = startCoord.clientX;
  const startY = startCoord.clientY;
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
    const elUnder = document.elementFromPoint(moveTouch.clientX, moveTouch.clientY);
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
        const isSame = !!info.fromResponseId && cardRespId === info.fromResponseId;
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
        const isSame = info.fromTarget === 'section' && (!targetSecId || targetSecId === info.fromSectionId);
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
      if (b) b.textContent = info.isDefect ? 'Defect' : 'Photo';
    }
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
        if (handlers.onSameQuestionAttempt) {
          handlers.onSameQuestionAttempt();
        }
      } else if (qId) {
        try {
          if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        } catch {}
        try {
          await handlers.onDropToQuestion(info.photoId, qId, info.fromSectionId);
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
        if (handlers.onSameSectionAttempt) {
          handlers.onSameSectionAttempt();
        }
      } else if (handlers.onDropToSection) {
        try {
          if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        } catch {}
        try {
          await handlers.onDropToSection(info.photoId, targetSecId);
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
