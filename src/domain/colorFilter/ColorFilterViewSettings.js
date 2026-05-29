const allowedPrimarySorts = new Set(['id', 'name', 'premium', 'percent', 'correct', 'incorrect', 'total']);
const allowedSecondarySorts = new Set(['ascending', 'descending']);

/** Loads and stores Color Filter sort/visibility preferences. */
export default class ColorFilterViewSettings {
  constructor({settingsManager, version = 2}) {
    this.settingsManager = settingsManager;
    this.version = version;
  }

  load(defaults) {
    const state = {...defaults};
    const filterView = this.settingsManager?.userSettings?.filterView;
    if (!filterView || typeof filterView != 'object') {return state;}

    const shouldMigrateBoughtSort = filterView.sortPrimary == 'bought';
    const shouldMigrateDefaultSort = filterView.defaultSortVersion !== this.version
      && (filterView.sortPrimary == 'total' || shouldMigrateBoughtSort)
      && filterView.sortSecondary == 'descending';

    if (shouldMigrateBoughtSort || shouldMigrateDefaultSort) {
      filterView.sortPrimary = 'total';
      filterView.sortSecondary = 'descending';
      filterView.sortBought = true;
      filterView.defaultSortVersion = this.version;
    }

    if (allowedPrimarySorts.has(filterView.sortPrimary)) {state.sortPrimary = filterView.sortPrimary;}
    if (allowedSecondarySorts.has(filterView.sortSecondary)) {state.sortSecondary = filterView.sortSecondary;}

    if (typeof filterView.sortBought == 'boolean') {state.sortBought = filterView.sortBought;}
    else if (shouldMigrateBoughtSort) {state.sortBought = true;}

    for (const key of ['showUnused', 'showCompleted', 'showFree', 'showPremium']) {
      if (typeof filterView[key] == 'boolean') {state[key] = filterView[key];}
    }

    return state;
  }

  persist(state, shouldSaveNow = false) {
    if (!this.settingsManager?.userSettings) {return;}

    this.settingsManager.userSettings.filterView = {
      sortPrimary: state.sortPrimary,
      sortSecondary: state.sortSecondary,
      sortBought: state.sortBought,
      showUnused: state.showUnused,
      showCompleted: state.showCompleted,
      showFree: state.showFree,
      showPremium: state.showPremium,
      defaultSortVersion: this.version
    };

    if (shouldSaveNow) {
      void this.settingsManager.saveUserStorageNow();
    }
  }
}
