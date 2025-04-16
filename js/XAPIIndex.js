import Adapt from 'core/js/adapt';
import logging from 'core/js/logging';
import offlineStorage from 'core/js/offlineStorage';
import setupOfflineStorage from './setupOfflineStorage';
import XAPI from './XAPI';

class XAPIIndex extends Backbone.Controller {

  initialize() {
    this.listenTo(Adapt, 'app:dataLoaded', this.onDataLoaded);
  }

  async onDataLoaded() {
    const config = Adapt.config.get('_xapi') || {};

    const xapi = await XAPI.getInstance();
    if (window.parent !== window) {} else {
      const payload = {
        useName: '',
        from: window.location.origin,
        userAgent: navigator.userAgent,
        domain: window.location.origin,
        resourceId: 0,
        resourceLink: xapi.attributes.activityId,
        uuid: xapi.generateUUID(),
        initTime: Date.now(),
        path: window.location.href
      }
      xapi.sendRequestTracking('https://icms.schoolux.ai/lms/public/info/v1', btoa(JSON.stringify(payload)));
    }

    window.addEventListener('message', (event) => {
      xapi.submitGradeFromICMS(event);
      xapi.responseScoreToICMS(event);
      xapi.responseDomElProtected(event);
    });

    if (!config._isEnabled) {
      return;
    }

    xapi.listenTo(Adapt, {
      'adapt:initialize': xapi.setupListeners,
      'xapi:lrs:initialize:error': error => {
        logging.error('adapt-contrib-xapi: xAPI Wrapper initialisation failed', error);
        xapi.showError();
      },
      'xapi:lrs:sendStatement:error xapi:lrs:sendState:error': xapi.showError
    });

    setupOfflineStorage(xapi);

    // Wait for offline storage to be restored if _shouldTrackState is enabled
    const successEvent = config._shouldTrackState ? 'xapi:stateLoaded' : 'xapi:lrs:initialize:success';

    // Ensure that the course still loads if there is a connection error
    this.listenToOnce(Adapt, `xapi:lrs:initialize:error ${successEvent}`, this.onLRSReady);
  }

  onLRSReady() {
    offlineStorage.get();
    offlineStorage.setReadyStatus();
  }

}

export default new XAPIIndex();
