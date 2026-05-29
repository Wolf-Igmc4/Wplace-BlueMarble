function localizeCompactDate(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(-2);
  const minute = String(date.getMinutes()).padStart(2, '0');
  const uses12HourClock = new Intl.DateTimeFormat(undefined, {hour: 'numeric'}).resolvedOptions().hour12;

  let hour = date.getHours();
  let period = '';
  if (uses12HourClock) {
    period = hour >= 12 ? ' PM' : ' AM';
    hour = hour % 12 || 12;
  } else {
    hour = String(hour).padStart(2, '0');
  }

  return `${day}/${month}/${year} ${hour}:${minute}${period}`;
}

/** Computes aggregate template progress data for the Color Filter UI. */
export function calculateColorFilterStats({templatesArray, palette}) {
  const stats = {
    tilesLoadedTotal: 0,
    tilesTotal: 0,
    allPixelsTotal: 0,
    allPixelsCorrectTotal: 0,
    allPixelsCorrect: new Map(),
    allPixelsColor: new Map(),
    timeRemaining: null,
    timeRemainingLocalized: '',
    colorStatistics: {}
  };

  for (const template of templatesArray) {
    const total = template.pixelCount?.total ?? 0;
    stats.allPixelsTotal += total ?? 0;

    const colors = template.pixelCount?.colors ?? new Map();
    for (const [colorID, colorPixels] of colors) {
      const numericPixels = Number(colorPixels) || 0;
      const allPixelsColorSoFar = stats.allPixelsColor.get(colorID) ?? 0;
      stats.allPixelsColor.set(colorID, allPixelsColorSoFar + numericPixels);
    }

    const correctObject = template.pixelCount?.correct ?? {};
    stats.tilesLoadedTotal += Object.keys(correctObject).length;
    stats.tilesTotal += Object.keys(template.chunked).length;

    for (const map of Object.values(correctObject)) {
      for (const [colorID, correctPixels] of map) {
        const numericCorrectPixels = Number(correctPixels) || 0;
        stats.allPixelsCorrectTotal += numericCorrectPixels;
        const allPixelsCorrectSoFar = stats.allPixelsCorrect.get(colorID) ?? 0;
        stats.allPixelsCorrect.set(colorID, allPixelsCorrectSoFar + numericCorrectPixels);
      }
    }
  }

  stats.timeRemaining = new Date(((stats.allPixelsTotal - stats.allPixelsCorrectTotal) * 30 * 1000) + Date.now());
  stats.timeRemainingLocalized = localizeCompactDate(stats.timeRemaining);

  for (const color of palette) {
    const colorTotal = stats.allPixelsColor.get(color.id) ?? 0;
    let colorCorrect = 0;

    if (colorTotal != 0) {
      colorCorrect = stats.allPixelsCorrect.get(color.id) ?? '???';
      if ((typeof colorCorrect != 'number') && (stats.tilesLoadedTotal == stats.tilesTotal) && !!color.id) {
        colorCorrect = 0;
      }
    }

    const colorIncorrect = parseInt(colorTotal) - parseInt(colorCorrect);
    const colorCompleted = (colorTotal > 0) && (typeof colorCorrect == 'number') && (colorIncorrect <= 0);

    stats.colorStatistics[color.id] = {
      colorTotal: colorTotal,
      colorCorrect: colorCorrect,
      colorIncorrect: colorIncorrect,
      colorCompleted: colorCompleted
    };
  }

  return stats;
}
