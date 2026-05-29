/** Adds the small control that moves Wplace's palette between top and bottom. */

export function installPaletteMoveButton() {
  let scheduled = false;

  const ensureMoveButton = () => {
    scheduled = false;

    const black = document.querySelector('#color-1');
    if (!black) {return;}

    let move = document.querySelector('#bm-button-move');
    if (move) {return;}

    move = document.createElement('button');
    move.id = 'bm-button-move';
    move.textContent = 'Move ↑';
    move.className = 'btn btn-soft';
    move.onclick = function() {
      const roundedBox = this.parentNode.parentNode.parentNode.parentNode;
      const shouldMoveUp = (this.textContent == 'Move ↑');
      roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? 'bottom' : 'top', shouldMoveUp ? 'top' : 'bottom');
      roundedBox.style.borderTopLeftRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
      roundedBox.style.borderTopRightRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
      roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
      roundedBox.style.borderBottomRightRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
      this.textContent = shouldMoveUp ? 'Move ↓' : 'Move ↑';
    };

    const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');
    paintPixel.parentNode?.appendChild(move);
  };

  const scheduleEnsureMoveButton = () => {
    if (scheduled) {return;}
    scheduled = true;
    requestAnimationFrame(ensureMoveButton);
  };

  const observer = new MutationObserver(scheduleEnsureMoveButton);
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleEnsureMoveButton();
  return observer;
}
