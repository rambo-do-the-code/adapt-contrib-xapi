import Adapt from 'core/js/adapt';
import data from 'core/js/data';
import COMPLETION_STATE from 'core/js/enums/completionStateEnum';
import logging from 'core/js/logging';
import notify from 'core/js/notify';
import offlineStorage from 'core/js/offlineStorage';
import wait from 'core/js/wait';
import Swal from  'libraries/sweet-alert.min';
import XAPIWrapper from 'libraries/xapiwrapper.min';

var validateToken = false;
var sessionToken = '';
var finishScore = {
  courseId: "",
  courseName: "",
  sessionId: "",
  schoolId: "",
  user: "",
  resourceId: "",
  mode: "",
  pages: []
};
var icmsBESyncUrlFinish= '';
var icmsBESyncUrlValidateToken = '';
var urlFetchCurrentPage = "";
var urlFetchMessageToast = '';

async function postValidateSessionToken() {
  const response = await fetch(icmsBESyncUrlValidateToken, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionToken: sessionToken
    })
  });
  return response.json();
}

async function getCurrentPageId() {
  const response = await fetch(urlFetchCurrentPage, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      "Authorization": `Bearer ${sessionToken}`
    },
  });
  return response.json();
}

function isKindyTheme() {
  // Ưu tiên class trên body/html; có thể mở rộng nếu bạn có flag khác.
  return document.querySelector('.kindy-theme')
      || document.documentElement.classList.contains('kindy-theme');
}

async function fetchMessageToast(triggerKey) {
  if (isKindyTheme()) {
    return Promise.resolve({ success: false, skipped: true });
  }
  try {
    const url = `${urlFetchMessageToast}?triggerKey=${encodeURIComponent(triggerKey)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    return await response.json();
  } catch (err) {
    // Không throw để tránh vỡ luồng UI; log và trả về object an toàn
    logging?.warn?.(`fetchMessageToast error: ${err?.message || err}`);
    return { success: false, error: err?.message || String(err) };
  }
}




function extractPageIdFromCurrentUrl() {
  const url = window.location.href;
  let match = url.match(/\/id\/([a-zA-Z0-9]+)/);
  if (match === null) {
    match = url.match(/[#\/]id\/([a-zA-Z0-9]+)/);
  }
  return match ? match[1] : null;
}

function redirectPageIdFromId(newCourseId) {
  
 const currentUrl = window.location.href;
  const newUrl = currentUrl + "#id/" + newCourseId;
  window.location.href = newUrl;
}

function getCourseUUID(url) {
  const match = url.match(/\/course\/([a-z0-9]+)\//i);
  return match ? match[1] : null;
}

function initImportantData() {
  const params = new URLSearchParams(window.location.search);
  sessionToken = params.get('sessionToken');
  finishScore.courseId = getCourseUUID(window.location.href);
  icmsBESyncUrlFinish = `https://${params.get('callbackSync')}/authoring-admin/external/sync/v1/finish`;
  icmsBESyncUrlValidateToken = `https://${params.get('callbackSync')}/authoring-admin/public/session/v1/validate`;
  urlFetchCurrentPage = `https://${params.get('callbackSync')}/authoring-admin/external/activity/v1/current-page`;
  urlFetchMessageToast = `https://${params.get('callbackSync')}/authoring-admin/external/sync/v1/shoutout-message`;
  // logging.info('initImportantData run');

 
}



class XAPI extends Backbone.Model {

  preinitialize() {
    // clear finishScore local storage
    // localStorage.removeItem('finishScore');
    initImportantData();
    // Declare defaults and model properties
    this.defaults = {
      lang: 'en-US',
      displayLang: 'en-US',
      generateIds: false,
      activityId: null,
      actor: null,
      shouldTrackState: true,
      shouldUseRegistration: false,
      componentBlacklist: 'blank,graphic',
      isInitialised: false,
      state: {}
    };
    this.correctStreak = 0;
    this.incorrectStreak = 0;
    this.xapiWrapper = XAPIWrapper;
    this.startAttemptDuration = 0;
    this.startTimeStamp = null;
    this.courseId = '';
    this.courseName = '';
    this.courseDescription = '';
    this.defaultLang = 'en-US';
    this.isComplete = false;


    // Default events to send statements for.
    this.coreEvents = {
      Adapt: {
        'router:page': false,
        'router:menu': false,
        'assessments:complete': true,
        'questionView:recordInteraction': true
      },
      contentObjects: {
        'change:_isComplete': false
      },
      articles: {
        'change:_isComplete': false
      },
      blocks: {
        'change:_isComplete': false
      },
      components: {
        'change:_isComplete': true
      }
    };

    // An object describing the core Adapt framework collections.
    this.coreObjects = {
      course: 'course',
      contentObjects: ['menu', 'page'],
      articles: 'article',
      blocks: 'block',
      components: 'component',
      offlineStorage: 'offlineStorage'
    };
  }

  /** Implementation starts here */
  async initialize() {
        console.log(data, 'datadatadata111');
    if (!this.getConfig('_isEnabled')) return this;

    // Check if the URL includes the keyword 'preview' it mean user in preview mode not need send data and validate token
    const currentUrl = window.location.href;
    const url = new URL(currentUrl);
    const hasSessionToken = url.searchParams.has('sessionToken');
        console.log(data, 'datadatadata');
    
    if (hasSessionToken) {
      console.log(
        "Session token found in URL. Proceeding with session validation and score submission."
      );  
      
      // Custom logic to validate the session token
      postValidateSessionToken()
          .then((data) => {
            if (data.success) {
              // Check if required parameters are present
              if (!data.data.params.user || !data.data.params.sessionId || !data.data.params.mode) {
                // Show error for missing required parameters
                Swal.fire({
                  title: 'Session Validation Failed',
                  text: 'Required parameters (user, session, mode) are missing. Switch to offline mode?',
                  icon: 'error',
                  confirmButtonText: 'OK'
                });
                logging.warn("--------------authoring Unsaved mode----------------");
                return this;
              } else if (data.data.params.mode !== 'test') {
                // Warn user about offline mode
                Swal.fire({
                  title: 'Offline Mode',
                  text: 'Proceed in offline mode? Unsaved progress will be lost.',
                  icon: 'warning',
                  confirmButtonText: 'OK'
                });
                logging.warn("--------------authoring Unsaved mode----------------");
                return this;
              }
              finishScore.user = data.data.params.user;
              finishScore.schoolId = data.data.params.schoolId;
              finishScore.sessionId = data.data.params.sessionId;
              finishScore.mode = data.data.params.mode;
              finishScore.resourceId = data.data.params.resourceId;

              // logging.info("---------------authoring test mode---------------");
              // set validateToken to true to send score to backend
              validateToken = true;
            } else {
              // show error when session validation fails
              Swal.fire({
                title: 'Session Validation Failed!',
                text: 'Continue in offline mode? Unsaved progress will not be saved.',
                icon: 'error',
                confirmButtonText: 'OK'
              });
              logging.warn("--------------authoring Unsaved mode----------------");
              return this;
            }
          })
          .catch((error) => {
            // catch any unexpected errors (network issues, server errors, etc.)
            Swal.fire({
              title: 'Error',
              text: `An error occurred while validating the session: ${error.message}. Please try again later.`,
              icon: 'error',
              confirmButtonText: 'OK'
            });
            logging.warn("--------------authoring Unsaved mode----------------");
            return this;
          });

       // getCurrentPageId().then((data) => {
       //
       //  if (data.success) {
       //    const currentPageId = data.data;
       //    if (currentPageId) {
       //      // redirect to the current page
       //      const extractedPageId = extractPageIdFromCurrentUrl();
       //      if (extractedPageId !== currentPageId) {
       //        redirectPageIdFromId(currentPageId);
       //      }
       //    } else {
       //      logging.warn("No current page ID found in the response.");
       //    }
       //  } else {
       //    logging.error("Failed to fetch current page ID:", data.message);
       //  }
       // })
    }

    

    wait.begin();

    // Initialize the xAPIWrapper.
    try {
      await this.initializeWrapper();
    } catch (error) {
      this.onInitialised(error);
      return this;
    }

    this.set({
      activityId: (this.getLRSAttribute('activity_id') || this.getConfig('_activityID') || this.getBaseUrl()),
      displayLang: Adapt.config.get('_defaultLanguage'),
      lang: this.getConfig('_lang'),
      generateIds: this.getConfig('_generateIds'),
      shouldTrackState: this.getConfig('_shouldTrackState'),
      shouldUseRegistration: this.getConfig('_shouldUseRegistration') || false,
      componentBlacklist: this.getConfig('_componentBlacklist') || []
    });

    let componentBlacklist = this.get('componentBlacklist');

    if (!Array.isArray(componentBlacklist)) {
      // Create the blacklist array and force the items to lowercase.
      componentBlacklist = componentBlacklist.split(/,\s?/).map(component => {
        return component.toLowerCase();
      });
    }

    this.set('componentBlacklist', componentBlacklist);

    if (!this.validateProps()) {
      const error = new Error('Missing required properties');
      logging.error('adapt-contrib-xapi: xAPI Wrapper initialisation failed', error);
      this.onInitialised(error);
      return this;
    }

    this.startTimeStamp = new Date();
    this.courseId = Adapt.course.get('_id') || '';
    this.courseName = Adapt.course.get('displayTitle') || Adapt.course.get('title');
    finishScore.courseName = Adapt.course.get('displayTitle') || Adapt.course.get('title');
    this.courseDescription = Adapt.course.get('description') || '';

    // Send the 'launched' and 'initialized' statements.
    const statements = [
      this.getCourseStatement(window.ADL.verbs.launched),
      this.getCourseStatement(window.ADL.verbs.initialized)
    ];

    try {
      await this.sendStatements(statements);
    } catch (error) {
      this.onInitialised(error);
      return this;
    }

    if (['ios', 'android'].indexOf(Adapt.device.OS) > -1) {
      $(document).on('visibilitychange', this.onVisibilityChange.bind(this));
    } else {
      $(window).on('beforeunload unload pagehide', this.sendUnloadStatements.bind(this));
    }

    if (!this.get('shouldTrackState')) {
      // xAPI is not managing the state.
      this.onInitialised();
      return this;
    }

    // Retrieve the course state.
    try {
      await this.getState();
    } catch (error) {
      this.onInitialised(error);
      return this;
    }

    const state = this.get('state');
    if (!state || Object.keys(state).length === 0) {
      // This is a new attempt, send 'attempted'.
      await this.sendStatement(this.getCourseStatement(window.ADL.verbs.attempted));
    } else {
      // This is a continuation of an existing attempt, send 'resumed'.
      await this.sendStatement(this.getCourseStatement(window.ADL.verbs.resumed));
    }

    this.restoreState();
    this.onInitialised();
    return this;
  }

  static getInstance() {
    if (!this.instance) this.instance = new XAPI();
    return this.instance;
  }

  /**
   * Replace the hard-coded _learnerInfo data in _globals with the actual data from the LRS.
   */
  getLearnerInfo() {
    const globals = Adapt.course.get('_globals');

    if (!globals._learnerInfo) {
      globals._learnerInfo = {};
    }

    Object.assign(globals._learnerInfo, offlineStorage.get('learnerinfo'));
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Intializes the ADL xapiWrapper code.
   */
  async initializeWrapper() {
    // If no endpoint has been configured, assume the ADL Launch method.
    if (!this.getConfig('_endpoint')) {
      // check to see if configuration has been passed in URL
      this.xapiWrapper = window.xapiWrapper || window.ADL.XAPIWrapper;
      if (this.checkWrapperConfig()) {
        // URL had all necessary configuration so we continue using it.
        // Set the LRS specific properties.
        this.set({
          registration: this.getLRSAttribute('registration'),
          actor: this.getLRSAttribute('actor')
        });

        this.xapiWrapper.strictCallbacks = true;

        return;
      }

      return new Promise((resolve, reject) => {
        // If no endpoint is configured, assume this is using the ADL launch method.
        window.ADL.launch((error, launchData, xapiWrapper) => {
          if (error) {
            return reject(error);
          }

          // Initialise the xAPI wrapper.
          this.xapiWrapper = xapiWrapper;

          this.set({
            actor: launchData.actor,
            registration: xapiWrapper.lrs.registration
          });

          this.xapiWrapper.strictCallbacks = true;

          return resolve();
        }, true, true);
      });
    }
    // The endpoint has been defined in the config, so use the static values.
    // Initialise the xAPI wrapper.
    this.xapiWrapper = window.xapiWrapper || window.ADL.XAPIWrapper;

    // Set any attributes on the xAPIWrapper.
    this.setWrapperConfig();

    // Set the LRS specific properties.
    this.set({
      registration: this.getLRSAttribute('registration'),
      actor: this.getLRSAttribute('actor')
    });

    this.xapiWrapper.strictCallbacks = true;
  }


  async  responseScoreToICMS(event){
    // if (event.origin !== this.linkICMS) return;
    if(event.data.type === 'score') {

      // logging.info('event get finish score:', JSON.stringify(finishScore, null, 2));

      const message = { type: 'responseScore', data: finishScore};
      window.parent.postMessage(message, '*');
    }
  }

  async responseDomElProtected(event) {
    if(event.data.type === 'initProtected') {
      const initData = event.data.payload;
      this.domElProtected(initData);
    }
  }


  async  submitGradeFromICMS(event){
    // if (event.origin !== this.linkICMS) return;
    if (event.data.type === 'submitGrade') {

      // logging.info('event submit finish score:', JSON.stringify(finishScore, null, 2));

      // submit event post data to be
      await this.postFinishScore();

      const message = { type: 'responseSubmit', data: "submit finish score"};
      window.parent.postMessage(message, '*');
    }
  }

  /**
   * Triggers 'plugin:endWait' event (if required).
   */
  onInitialised(error) {
    this.set({ isInitialised: !error });

    wait.end();

    _.defer(() => {
      if (error) {
        Adapt.trigger('xapi:lrs:initialize:error', error);
        return;
      }

      Adapt.trigger('xapi:lrs:initialize:success');
    });
  }

  async onLanguageChanged(newLanguage) {
    // Update the language.
    this.set({ displayLang: newLanguage });

    // Since a language change counts as a new attempt, reset the state.
    await this.deleteState();
    // Send a statement to track the (new) course.
    await this.sendStatement(this.getCourseStatement(window.ADL.verbs.launched));
  }

  /**
   * Sends 'suspended' and 'terminated' statements to the LRS when the window
   * is closed or the browser app is minimised on a device. Sends a 'resume'
   * statement when switching back to a suspended session.
   */
  async onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      this.isTerminated = false;

      return this.sendStatement(this.getCourseStatement(window.ADL.verbs.resumed));
    }

    await this.sendUnloadStatements();
  }

  // Sends (optional) 'suspended' and 'terminated' statements to the LRS.
  async sendUnloadStatements() {
    if (this.isTerminated) return;

    const statements = [];

    if (!this.isComplete) {
      // If the course is still in progress, send the 'suspended' verb.
      statements.push(this.getCourseStatement(window.ADL.verbs.suspended));
    }

    // Always send the 'terminated' verb.
    statements.push(this.getCourseStatement(window.ADL.verbs.terminated));

    // Note: it is not possible to intercept these synchronous statements.
    await this.sendStatementsSync(statements);

    this.isTerminated = true;
  }

  /**
   * Check Wrapper to see if all parameters needed are set.
   */
  checkWrapperConfig() {
    const lrs = this.xapiWrapper.lrs;
    if (lrs.endpoint && lrs.actor && lrs.auth && lrs.activity_id) return true;
    return false;
  }

  /**
   * Attempt to extract endpoint, user and password from the config.json.
   */
  setWrapperConfig() {
    const keys = ['endpoint', 'user', 'password'];
    const newConfig = {};

    keys.forEach(key => {
      let val = this.getConfig('_' + key);

      if (val) {
        // Note: xAPI wrapper requires a trailing slash and protocol to be present
        if (key === 'endpoint') {
          val = val.replace(/\/?$/, '/');

          if (!/^https?:\/\//i.test(val)) {
            logging.warn('adapt-contrib-xapi: "_endpoint" value is missing protocol (defaulting to http://)');

            val = 'http://' + val;
          }
        }

        newConfig[key] = val;
      }
    });

    if (Object.keys(newConfig).length > 0) {
      this.xapiWrapper.changeConfig(newConfig);

      if (!this.xapiWrapper.testConfig()) {
        throw new Error('Incorrect xAPI configuration detected');
      }
    }
  }

  /**
   * Gets the URL the course is currently running on.
   * @return {string} The URL to the current course.
   */
  getBaseUrl() {
    const url = window.location.origin + window.location.pathname;

    // logging.info(`adapt-contrib-xapi: Using detected URL (${url}) as ActivityID`);

    return url;
  }

  getAttemptDuration() {
    return this.startAttemptDuration + this.getSessionDuration();
  }

  getSessionDuration() {
    return Math.abs((new Date()) - this.startTimeStamp);
  }

  /**
   * Converts milliseconds to an ISO8601 duration
   * @param {int} inputMilliseconds - Duration in milliseconds
   * @return {string} - Duration in ISO8601 format
   */
  convertMillisecondsToISO8601Duration(inputMilliseconds) {
    const iInputMilliseconds = parseInt(inputMilliseconds, 10);
    let inputIsNegative = '';
    let rtnStr = '';

    // Round to nearest 0.01 seconds.
    let iInputCentiseconds = Math.round(iInputMilliseconds / 10);

    if (iInputCentiseconds < 0) {
      inputIsNegative = '-';
      iInputCentiseconds = iInputCentiseconds * -1;
    }

    const hours = parseInt(((iInputCentiseconds) / 360000), 10);
    const minutes = parseInt((((iInputCentiseconds) % 360000) / 6000), 10);
    const seconds = (((iInputCentiseconds) % 360000) % 6000) / 100;

    rtnStr = inputIsNegative + 'PT';
    if (hours > 0) {
      rtnStr += hours + 'H';
    }

    if (minutes > 0) {
      rtnStr += minutes + 'M';
    }

    rtnStr += seconds + 'S';

    return rtnStr;
  }

  setupListeners() {
    if (!this.get('isInitialised')) {
      logging.warn('adapt-contrib-xapi: Unable to setup listeners for xAPI');
      return;
    }

    // Allow surfacing the learner's info in _globals.
    this.getLearnerInfo();

    this.listenTo(Adapt, 'app:languageChanged', this.onLanguageChanged);

    if (this.get('shouldTrackState')) {
      this.listenTo(Adapt, 'state:change', this.sendState);
    }

    // Use the config to specify the core events.
    this.coreEvents = Object.assign(this.coreEvents, this.getConfig('_coreEvents'));

    // Always listen out for course completion.
    this.listenTo(Adapt, 'tracking:complete', this.onTrackingComplete);

    // Conditionally listen to the events.
    // Visits to the menu.
    if (this.coreEvents.Adapt['router:menu']) {
      this.listenTo(Adapt, 'router:menu', this.onItemExperience);
    }

    // Visits to a page.
    if (this.coreEvents.Adapt['router:page']) {
      this.listenTo(Adapt, 'router:page', this.onItemExperience);
    }

    // When an interaction takes place on a question.
    if (this.coreEvents.Adapt['questionView:recordInteraction']) {
      this.listenTo(Adapt, 'questionView:recordInteraction', this.onQuestionInteraction);
    }

    // When an assessment is completed.
    if (this.coreEvents.Adapt['assessments:complete']) {
      this.listenTo(Adapt, 'assessments:complete', this.onAssessmentComplete);
    }

    // Standard completion events for the various collection types, i.e.
    // course, contentobjects, articles, blocks and components.
    Object.keys(this.coreEvents).forEach(key => {
      if (key !== 'Adapt') {
        const val = this.coreEvents[key];

        if (typeof val === 'object' && val['change:_isComplete'] === true) {
          this.listenTo(Adapt[key], 'change:_isComplete', this.onItemComplete);
        }
      }
    });
  }

  /**
   * Gets an xAPI Activity (with an 'id of the activityId) representing the course.
   * @returns {window.ADL.XAPIStatement.Activity} Activity representing the course.
   */
  getCourseActivity() {
    const object = new window.ADL.XAPIStatement.Activity(this.get('activityId'));
    const name = {};
    const description = {};

    name[this.get('displayLang')] = this.courseName;
    description[this.get('displayLang')] = this.courseDescription;

    object.definition = {
      type: window.ADL.activityTypes.course,
      name,
      description
    };

    return object;
  }

  /**
   * Creates an xAPI statement related to the Adapt.course object.
   * @param {object | string} verb - A valid ADL.verbs object or key.
   * @param {object} [result] - An optional result object.
   * @return A valid ADL statement object.
   */
  getCourseStatement(verb, result) {
    if (typeof result === 'undefined') {
      result = {};
    }

    const object = this.getCourseActivity();

    // Append the duration.
    switch (verb) {
      case window.ADL.verbs.launched:
      case window.ADL.verbs.initialized:
      case window.ADL.verbs.attempted: {
        result.duration = 'PT0S';
        break;
      }

      case window.ADL.verbs.failed:
      case window.ADL.verbs.passed:
      case window.ADL.verbs.suspended: {
        result.duration = this.convertMillisecondsToISO8601Duration(this.getAttemptDuration());
        break;
      }

      case window.ADL.verbs.terminated: {
        result.duration = this.convertMillisecondsToISO8601Duration(this.getSessionDuration());
        break;
      }
    }

    return this.getStatement(this.getVerb(verb), object, result);
  }

  /**
   * Gets a name object from a given model.
   * @param {Backbone.Model} model - An instance of Adapt.Model (or Backbone.Model).
   * @return {object} An object containing a key-value pair with the language code and name.
   */
  getNameObject(model) {
    const name = {};

    name[this.get('displayLang')] = model.get('displayTitle') || model.get('title');

    return name;
  }

  /**
   * Gets the activity type for a given model.
   * @param {Backbone.Model} model - An instance of Adapt.Model (or Backbone.Model).
   * @return {string} A URL to the current activity type.
   */
  getActivityType(model) {
    let type = '';

    switch (model.get('_type')) {
      case 'component': {
        type = model.get('_isQuestionType') ? window.ADL.activityTypes.interaction : window.ADL.activityTypes.media;
        break;
      }
      case 'block':
      case 'article': {
        type = window.ADL.activityTypes.interaction;
        break;
      }
      case 'course': {
        type = window.ADL.activityTypes.course;
        break;
      }
      case 'menu': {
        type = window.ADL.activityTypes.module;
        break;
      }
      case 'page': {
        type = window.ADL.activityTypes.lesson;
        break;
      }
    }

    return type;
  }

  /**
   * Sends an 'answered' statement to the LRS.
   * @param {ComponentView} view - An instance of Adapt.ComponentView.
   */
  async onQuestionInteraction(view) {
    if ((!view.model || view.model.get('_type') !== 'component') &&
        !view.model.get('_isQuestionType')) return;

    // This component is on the blacklist, so do not send a statement.
    if (this.isComponentOnBlacklist(view.model.get('_component'))) return;

    const object = new window.ADL.XAPIStatement.Activity(this.getUniqueIri(view.model));
    const completion = view.model.get('_isComplete');
    const lang = this.get('displayLang');
    const description = {};

    description[lang] = this.stripHtml(view.model.get('body'));

    object.definition = {
      name: this.getNameObject(view.model),
      description,
      type: window.ADL.activityTypes.question,
      interactionType: view.getResponseType()
    };

    if (typeof view.getInteractionObject === 'function') {
      // Get any extra interactions.
      Object.assign(object.definition, view.getInteractionObject());

      // Ensure any 'description' properties are objects with the language map.
      Object.keys(object.definition).forEach(key => {
        if (!object.definition[key]?.length) return;
        for (let i = 0; i < object.definition[key].length; i++) {
          if (!Object.prototype.hasOwnProperty.call(object.definition[key][i], 'description')) {
            break;
          }

          if (typeof object.definition[key][i].description === 'string') {
            const description = {};
            description[lang] = object.definition[key][i].description;

            object.definition[key][i].description = description;
          }
        }
      });
    }

    const result = {
      score: {
        raw: view.model.get('_score') || 0
      },
      success: view.model.get('_isCorrect'),
      completion,
      response: this.processInteractionResponse(object.definition.interactionType, view.getResponse())
    };

    // Answered
    const statement = this.getStatement(this.getVerb(window.ADL.verbs.answered), object, result);

    this.addGroupingActivity(view.model, statement);
    await this.handleStatement(statement)
    

    // Check answer correctness
  if (result.success === true) {
    this.correctStreak += 1;
    this.incorrectStreak = 0;
  } else if (result.success === false) {
    this.incorrectStreak += 1;
    this.correctStreak = 0;
  }

// Show toast if 3 in a row
  if (this.correctStreak === 5) {
    this.correctStreak = 0;
    this.showToastMessage('PERFECT_STREAK', 9);
  }

  if (this.incorrectStreak === 3) {
    this.incorrectStreak = 0;
    this.showToastMessage('INCORRECT_ANSWERS', 10);
  }

  }

  async handleStatement(statement) {
    try {
      const response = await this.sendStatement(statement);
      const triggerKey = response?.data?.triggerKey || "";
      const randomNumber = Math.floor(Math.random() * (8 - 3 + 1)) + 3;

      if (triggerKey) {
        this.showToastMessage(triggerKey, randomNumber);
      }
    } catch (error) {
      console.error("Error handling statement:", error);
    }
  }

  isKindyTheme() {
  // Ưu tiên class trên body/html; có thể mở rộng nếu bạn có flag khác.
  return document.body.classList.contains('kindy-theme')
      || document.documentElement.classList.contains('kindy-theme');
  }



  async  showToastMessage(message, type = 9) {
  const data = await fetchMessageToast(message);

  // Guard: nếu skip vì theme, hoặc call fail, thì thôi
  if (!data || !data.success || !data?.data?.messageEn) return;

  const messageToast = data.data.messageEn;

  Swal.fire({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 5000,
    html: `
      <div class="toast-inner type-${type}">
        <div class="toast-text">
          <div class="toast-title">${
            type === 9 ? "YEAHHHH !" : type <= 8 ? "LET'S GO !" : "OOPS !"
          }</div>
          <div class="toast-message">${messageToast}</div>
        </div>
      </div>
    `,
  });
}

  /**
   * Removes the HTML tags/attributes and returns a string.
   * @param {string} html - A string containing HTML
   * @returns {string} The same string minus HTML
   */
  stripHtml(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    return tempDiv.textContent || tempDiv.innerText || '';
  }

  /**
   * In order to support SCORM 1.2 and SCORM 2004, some of the components return a non-standard
   * response.
   * @param {string} responseType - The type of the response.
   * @param {string} response - The unprocessed response string.
   * @returns {string} A response formatted for xAPI compatibility.
   */
  processInteractionResponse(responseType, response) {
    switch (responseType) {
      case 'choice': {
        response = response.replace(/,|#/g, '[,]');





        break;
      }
      case 'matching': {
        // Example: 1[.]1_1[,]2[.]2_5
        response = response
            .split('#')
            .map((val, i) => {
              return (i + 1) + '[.]' + val.replace('.', '_');
            })
            .join('[,]');
        break;
      }
    }

    return response;
  }

  /**
   * Sends an xAPI statement when an item has been experienced.
   * @param {AdaptModel} model - An instance of AdaptModel, i.e. ContentObjectModel, etc.
   */
  async onItemExperience(model) {
    if (model.get('_id') === 'course') {
      // We don't really want to track actions on the home menu.
      return;
    }

    const object = new window.ADL.XAPIStatement.Activity(this.getUniqueIri(model));

    object.definition = {
      name: this.getNameObject(model),
      type: this.getActivityType(model)
    };

    // Experienced.
    const statement = this.getStatement(this.getVerb(window.ADL.verbs.experienced), object);

    this.addGroupingActivity(model, statement);
    await this.handleStatement(statement);
  }

  /**
   * Checks if a given component is blacklisted from sending statements.
   * @param {string} component - The name of the component.
   * @returns {boolean} true if the component exists on the blacklist.
   */
  isComponentOnBlacklist(component) {
    return this.get('componentBlacklist').indexOf(component) !== -1;
  }

  /**
   * Sends an xAPI statement when an item has been completed.
   * @param {AdaptModel} model - An instance of AdaptModel, i.e. ComponentModel, BlockModel, etc.
   * @param {boolean} isComplete - Flag to indicate if the model has been completed
   */
  async onItemComplete(model, isComplete) {
    // The item is not actually completed, e.g. it may have been reset.
    if (isComplete === false) return;

    // If this is a question component (interaction), do not record multiple statements.
    // Return because 'Answered' will already have been passed.
    if (model.get('_type') === 'component' && model.get('_isQuestionType') === true &&
        this.coreEvents.Adapt['questionView:recordInteraction'] === true &&
        this.coreEvents.components['change:_isComplete'] === true) return;

    // This component is on the blacklist, so do not send a statement.
    if (model.get('_type') === 'component' && this.isComponentOnBlacklist(model.get('_component'))) return;

    const result = { completion: true };
    const object = new window.ADL.XAPIStatement.Activity(this.getUniqueIri(model));

    object.definition = {
      name: this.getNameObject(model),
      type: this.getActivityType(model)
    };

    // Completed.
    const statement = this.getStatement(this.getVerb(window.ADL.verbs.completed), object, result);

    this.addGroupingActivity(model, statement);
    await this.handleStatement(statement);
  }

  /**
   * Gets a lesson activity for a given page.
   * @param {string|Adapt.Model} page - Either an Adapt contentObject model of type 'page', or the _id of one.
   * @returns {XAPIStatement.Activity} Activity corresponding to the lesson.
   */
  getLessonActivity(page) {
    const pageModel = (typeof page === 'string')
        ? data.findById(page)
        : page;
    const activity = new window.ADL.XAPIStatement.Activity(this.getUniqueIri(pageModel));
    const name = this.getNameObject(pageModel);

    activity.definition = {
      name,
      type: window.ADL.activityTypes.lesson
    };

    return activity;
  }

  /**
   * Adds a 'grouping' and/or 'parent' value to a statement's contextActivities.
   * Note: the 'parent' is only added in the case of a question component which is part of
   * an assessment. All articles, blocks and components are grouped by page.
   * @param {Adapt.Model} model - Any Adapt model.
   * @param {ADL.XAPIStatement} statement - A valid xAPI statement object.
   */
  addGroupingActivity(model, statement) {
    const type = model.get('_type');

    if (type !== 'course') {
      // Add a grouping for the course.
      statement.addGroupingActivity(this.getCourseActivity());
    }

    if (['article', 'block', 'component'].indexOf(type) !== -1) {
      // Group these items by page/lesson.
      const pageModel = model.findAncestor('pages');

      statement.addGroupingActivity(this.getLessonActivity(pageModel));
    }

    if (type === 'component' && model.get('_isPartOfAssessment')) {
      // Get the article containing this question component.
      const articleModel = model.findAncestor('articles');

      if (articleModel?.has('_assessment')?._isEnabled) {
        // Set the assessment as the parent.
        const assessment = {
          id: articleModel.get('_assessment')._id,
          articleId: articleModel.get('_id'),
          type: 'article-assessment',
          pageId: articleModel.get('_parentId')
        };

        statement.addParentActivity(this.getAssessmentObject(assessment));
      }
    }
  }

  /**
   * Takes an assessment state and returns a results object based on it.
   * @param {object} assessment - An instance of the assessment state.
   * @return {object} - A result object containing score, success and completion properties.
   */
  getAssessmentResultObject(assessment) {
    return {
      score: {
        scaled: (assessment.scoreAsPercent / 100),
        raw: assessment.score,
        min: 0,
        max: assessment.maxScore
      },
      success: assessment.isPass,
      completion: assessment.isComplete
    };
  }

  /**
   * Gets an Activity for use in an xAPI statement.
   * @param {object} assessment - Object representing the assessment.
   * @returns {ADL.XAPIStatement.Activity} - Activity representing the assessment.
   */
  getAssessmentObject(assessment) {
    // Instantiate a Model so it can be used to obtain an IRI.
    const fakeModel = new Backbone.Model({
      _id: assessment.id || assessment.articleId,
      _type: assessment.type,
      pageId: assessment.pageId
    });

    const object = new window.ADL.XAPIStatement.Activity(this.getUniqueIri(fakeModel));
    const name = {};

    name[this.get('displayLang')] = assessment.id || 'Assessment';

    object.definition = {
      name: name,
      type: window.ADL.activityTypes.assessment
    };

    return object;
  }

  /**
   * Sends an xAPI statement when an assessment has been completed.
   * @param {object} assessment - Object representing the state of the assessment.
   */
  onAssessmentComplete(assessment) {
    const object = this.getAssessmentObject(assessment);
    const result = this.getAssessmentResultObject(assessment);
    let statement;

    if (assessment.isPass) {
      // Passed.
      statement = this.getStatement(this.getVerb(window.ADL.verbs.passed), object, result);
    } else {
      // Failed.
      statement = this.getStatement(this.getVerb(window.ADL.verbs.failed), object, result);
    }

    statement.addGroupingActivity(this.getCourseActivity());
    statement.addGroupingActivity(this.getLessonActivity(assessment.pageId));

    // Delay so that component completion can be recorded before assessment completion.
    _.delay(async () => {
      await this.handleStatement(statement);
    }, 500);
  }

  /**
   * Gets a valid 'verb' object in the ADL.verbs and returns the correct language version.
   * @param {object|stirng} verb - A valid ADL verb object or key, e.g. 'completed'.
   * @return {object} An ADL verb object with 'id' and language specific 'display' properties.
   */
  getVerb(verb) {
    if (typeof verb === 'string') {
      const key = verb.toLowerCase();
      verb = window.ADL.verbs[key];

      if (!verb) {
        logging.error(`adapt-contrib-xapi: Verb " ${key} " does not exist in window.ADL.verbs object`);
      }
    }

    if (typeof verb !== 'object') {
      throw new Error('Unrecognised verb: ' + verb);
    }

    const lang = this.get('lang') || this.defaultLang;

    const singleLanguageVerb = {
      id: verb.id,
      display: {}
    };

    const description = verb.display[lang];

    if (description) {
      singleLanguageVerb.display[lang] = description;
      return singleLanguageVerb;
    }
    // Fallback in case the verb translation doesn't exist.
    singleLanguageVerb.display[this.defaultLang] = verb.display[this.defaultLang];
    return singleLanguageVerb;
  }

  /**
   * Gets a unique IRI for a given model.
   * @param {AdaptModel} model - An instance of an AdaptModel object.
   * @return {string} An IRI formulated specific to the passed model.
   */
  getUniqueIri(model) {
    let iri = this.get('activityId');
    const type = model.get('_type');

    if (type !== 'course') {
      if (type === 'article-assessment') {
        iri = iri + ['#', 'assessment', model.get('_id')].join('/');
      } else {
        iri = iri + ['#/id', model.get('_id')].join('/');
      }
    }

    return iri;
  }

  /**
   * Handler for the Adapt Framework's 'tracking:complete' event.
   * @param {object} completionData
   */
  onTrackingComplete(completionData) {
    let result = {};
    let completionVerb;

    // Check the completion status.
    switch (completionData.status) {
      case COMPLETION_STATE.PASSED: {
        completionVerb = window.ADL.verbs.passed;
        break;
      }

      case COMPLETION_STATE.FAILED: {
        completionVerb = window.ADL.verbs.failed;
        break;
      }

      default: {
        completionVerb = window.ADL.verbs.completed;
      }
    }

    if (completionVerb === window.ADL.verbs.completed) {
      result = { completion: true };
    } else {
      // The assessment(s) play a part in completion, so use their result.
      result = this.getAssessmentResultObject(completionData.assessment);
    }

    // Store a reference that the course has actually been completed.
    this.isComplete = true;

    _.defer(async () => {
      // Send the completion status.
      await this.sendStatement(this.getCourseStatement(completionVerb, result));
    });
  }

  /**
   * Refresh course progress from loaded state.
   */
  restoreState() {
    const state = this.get('state');

    if (state && Object.keys(state).length === 0) return;

    const Adapt = require('core/js/adapt');

    if (state.components) {
      state.components.forEach(stateObject => {
        const restoreModel = Adapt.findById(stateObject._id);

        if (restoreModel) {
          restoreModel.setTrackableState(stateObject);
        } else {
          logging.warn('adapt-contrib-xapi: Unable to restore state for component: ' + stateObject._id);
        }
      });
    }

    if (state.blocks) {
      state.blocks.forEach(stateObject => {
        const restoreModel = Adapt.findById(stateObject._id);

        if (restoreModel) {
          restoreModel.setTrackableState(stateObject);
        } else {
          logging.warn('adapt-contrib-xapi: Unable to restore state for block: ' + stateObject._id);
        }
      });
    }
  }

  /**
   * Generate an XAPIstatement object for the xAPI wrapper sendStatement methods.
   * @param {object} verb - A valid ADL.verbs object.
   * @param {object} object -
   * @param {object} [result] - optional
   * @param {object} [context] - optional
   * @return {ADL.XAPIStatement} A formatted xAPI statement object.
   */
  getStatement(verb, object, result, context) {
    const statement = new window.ADL.XAPIStatement(
        new window.ADL.XAPIStatement.Agent(this.get('actor')),
        verb,
        object
    );

    if (result && Object.keys(result).length > 0) {
      statement.result = result;
    }

    if (context) {
      statement.context = context;
    }

    if (this.get('_generateIds')) {
      statement.generateId();
    }
    statement.pageId = extractPageIdFromCurrentUrl();
    //make sure actor always null we will process actor in BE SYNC by token extract
    statement.actor = null;
    return statement;
  }

  /**
   * Sends the state to the or the given model to the configured LRS.
   * @param {AdaptModel} model - The AdaptModel whose state has changed.
   */
  sendState(model, modelState) {
    if (this.get('shouldTrackState') !== true || model.get('_isTrackable') === false) {
      return;
    }

    const activityId = this.get('activityId');
    const actor = this.get('actor');
    const type = model.get('_type');
    const state = this.get('state');
    const registration = this.get('shouldUseRegistration') === true
        ? this.get('registration')
        : null;
    const collectionName = _.findKey(this.coreObjects, o => {
      return (o === type || o.indexOf(type) > -1);
    });
    const stateCollection = Array.isArray(state[collectionName]) ? state[collectionName] : [];
    let newState;

    if (collectionName !== 'course' && collectionName !== 'offlineStorage') {
      const index = _.findIndex(stateCollection, { _id: model.get('_id') });

      if (index !== -1) {
        stateCollection.splice(index, 1, modelState);
      } else {
        stateCollection.push(modelState);
      }

      newState = stateCollection;
    } else {
      newState = modelState;
    }

    // Update the locally held state.
    state[collectionName] = newState;
    this.set({
      state
    });

    // Pass the new state to the LRS.
    this.xapiWrapper.sendState(activityId, actor, collectionName, registration, newState, null, null, (error, xhr) => {
      if (error) {
        Adapt.trigger('xapi:lrs:sendState:error', error);
      }

      Adapt.trigger('xapi:lrs:sendState:success', newState);
    });
  }

  /**
   * Retrieves the state information for the current course.
   */
  async getState() {
    const activityId = this.get('activityId');
    const actor = this.get('actor');
    const registration = this.get('shouldUseRegistration') === true
        ? this.get('registration')
        : null;
    const state = {};

    try {
      for (let type in this.coreObjects) {
        await new Promise((resolve, reject) => {
          this.xapiWrapper.getState(activityId, actor, type, registration, null, (error, xhr) => {
            if (error) {
              logging.warn(`adapt-contrib-xapi: getState() failed for ${activityId} (${type})`);
              return reject(new Error(error));
            }

            if (!xhr) {
              logging.warn(`adapt-contrib-xapi: getState() failed for ${activityId} (${type})`);
              return reject(new Error('\'xhr\' parameter is missing from callback'));
            }

            if (xhr.status === 404) {
              return resolve();
            }

            if (xhr.status !== 200) {
              logging.warn(`adapt-contrib-xapi: getState() failed for ${activityId} (${type})`);
              return reject(new Error(`Invalid status code ${xhr.status} returned from getState() call`));
            }

            // Check for empty response, otherwise the subsequent JSON.parse() will fail.
            if (xhr.response === '') {
              return resolve();
            }

            try {
              const response = JSON.parse(xhr.response);

              if (!_.isEmpty(response)) {
                state[type] = response;
              }
            } catch (parseError) {
              return reject(parseError);
            }

            return resolve();
          });
        });
      }
    } catch (error) {
      logging.error('adapt-contrib-xapi:', error);
      throw error;
    }

    if (!_.isEmpty(state)) {
      this.set({ state });
    }

    Adapt.trigger('xapi:stateLoaded');
  }

  /**
   * Deletes all state information for the current course.
   */
  async deleteState() {
    const activityId = this.get('activityId');
    const actor = this.get('actor');
    const registration = this.get('shouldUseRegistration') === true
        ? this.get('registration')
        : null;

    try {
      for (let type in this.coreObjects) {
        await new Promise((resolve, reject) => {
          this.xapiWrapper.deleteState(activityId, actor, type, registration, null, null, (error, xhr) => {
            if (error) {
              logging.warn(`adapt-contrib-xapi: deleteState() failed for ${activityId} (${type})`);
              return reject(error);
            }

            if (!xhr) {
              logging.warn(`adapt-contrib-xapi: deleteState() failed for ${activityId} (${type})`);
              return reject(new Error('\'xhr\' parameter is missing from callback'));
            }

            if (xhr.status !== 204) {
              logging.warn(`adapt-contrib-xapi: deleteState() failed for ${activityId} (${type})`);
              return reject(new Error(`Invalid status code ${xhr.status} returned from getState() call`));
            }

            return resolve();
          });
        });
      }
    } catch (error) {
      logging.error('adapt-contrib-xapi:', error);
      throw error;
    }
  }

  /**
   * Retrieve a config item for the current course, e.g. '_activityID'.
   * @param {string} key - The data attribute to fetch.
   * @return {object|boolean} The attribute value, or false if not found.
   */
  getConfig(key) {
    const config = Adapt.config?.get('_xapi');
    if (!config || key === '' || typeof config[key] === 'undefined') {
      return false;
    }

    return config[key];
  }

  /**
   * Retrieve an LRS attribute for the current session, e.g. 'actor'.
   * @param {string} key - The attribute to fetch.
   * @return {object|null} the attribute value, or null if not found.
   */
  getLRSAttribute(key) {
    if (!this.xapiWrapper || !this.xapiWrapper.lrs || undefined === this.xapiWrapper.lrs[key]) {
      return null;
    }

    try {
      switch (key) {
        case 'actor': {
          const actor = JSON.parse(this.xapiWrapper.lrs[key]);

          if (Array.isArray(actor.name)) {
            // Convert the name from an array to a string.
            actor.name = actor.name[0];
          }

          if (Array.isArray(actor.mbox)) {
            // Convert mbox from an array to a string.
            actor.mbox = actor.mbox[0];
          }

          // If the account is an array, some work will be required.
          if (Array.isArray(actor.account)) {
            const account = {};

            // Convert 'accountServiceHomePage' to 'homePage'.
            if (typeof actor.account[0].accountServiceHomePage !== 'undefined') {
              account.homePage = actor.account[0].accountServiceHomePage;
            } else if (actor.account[0].homePage !== 'undefined') {
              account.homePage = actor.account[0].homePage;
            }

            // Convert 'accountName' to 'name'.
            if (typeof actor.account[0].accountName !== 'undefined') {
              account.name = actor.account[0].accountName;
            } else if (typeof actor.account[0].name !== 'undefined') {
              account.name = actor.account[0].name;
            }

            // Out with the old array.
            delete actor.account;

            // In with the new object.
            actor.account = account;
          }

          return actor;
        }
        default:
          return this.xapiWrapper.lrs[key];
      }
    } catch (e) {
      return null;
    }
  }

  getLRSExtendedAttribute(key) {
    const extended = this.getLRSAttribute('extended');
    if (extended == null) {
      return null;
    }

    try {
      if (key === 'definition') {
        return JSON.parse(extended.definition);
      }

      return extended[key];
    } catch (e) {
      return null;
    }
  }

  /**
   * Checks that the required properties -- actor and activityId -- are defined, and
   * logs a warning if any of them are not.
   * @return {boolean} true if the properties are valid, false otherwise.
   */
  validateProps() {
    let errorCount = 0;

    // if (!this.get('actor') || typeof this.get('actor') !== 'object') {
    //   logging.warn('adapt-contrib-xapi: "actor" attribute not found!');
    //   errorCount++;
    // }

    if (!this.get('activityId')) {
      logging.warn('adapt-contrib-xapi: "activityId" attribute not found!');
      errorCount++;
    }

    if (errorCount > 0) {
      return false;
    }

    return true;
  }


  /**
   * Prepares to send a single xAPI statement to the LRS.
   * @param {ADL.XAPIStatement} statement - A valid ADL.XAPIStatement object.
   * @param {array} [attachments] - An array of attachments to pass to the LRS.
   */
  async sendStatement(statement, attachments = null) {
    if (!statement || !validateToken) {
      return;
    }

    Adapt.trigger('xapi:preSendStatement', statement);

    // Allow the trigger above to augment attachments if the attachments
    // parameter is not set.
    if (!attachments && statement.attachments) {
      return await this.processAttachments(statement);
    }
    // add custom logic finish score
    this.addResultToFinishScore(statement);

    return  this.onStatementReady(statement, attachments);
  }

  postFinishScore() {
    fetch(icmsBESyncUrl+'/public/sync/v1/finish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(finishScore)
    })
        .then(response => response.json())
        .then(data => {
          console.log('Success:', data);
        })
        .catch((error) => {
          console.error('Error:', error);
        });
  }

  // custom finish score
  addResultToFinishScore(statement) {
    if (statement.pageId) {
      // find the page by pageId
      let page = finishScore.pages.find(page => page.pageId === statement.pageId);
      const isCompletePage = this.hasAssessmentKeyInUrl(statement.object.id);

      // if the page does not exist, add it to the pages array
      if (!page) {
        page = {
          pageId: statement.pageId,
          pageName: "Page name",
          startTime: Date.now(),
          endTime: null,
          components: []
        };
        finishScore.pages.push(page);
      }

      // if the statement has a result and the page exists, add component details
      if (statement.hasOwnProperty('result')) {
        if (isCompletePage) {
          page.endTime = Date.now();
        } else {
          const componentId = this.extractComponentId(statement.object.id);
          const component = {
            componentId: componentId,
            maxScore: statement.result?.score?.max ?? 0,
            rawScore: statement.result?.score?.raw ?? null,
            answer: statement.result?.response ?? null,
            success: statement.result?.success ?? null,
            completion: statement.result?.completion ?? null,
            startTime: page.startTime ?? null,
            endTime: Date.now() ?? null
          };
          page.components.push(component);
        }
      }

      // save finishScore to local storage
      try {
        localStorage.setItem('finishScore', JSON.stringify(finishScore));
      } catch (e) {
        console.error("Error saving finishScore to localStorage:", e);
      }
    }
  }


  hasAssessmentKeyInUrl(url) {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      const fragment = urlObj.hash;

      // Combine path and fragment for the search
      const combined = path + (fragment ? fragment : "");

      // Use the 'i' flag for case-insensitive matching
      const pattern = /\/Assessment\/([^/]+)/i;
      return pattern.test(combined);
    } catch (e) {
      return false;
    }
  }


  extractComponentId(url) {
    // Match the UUID pattern at the end of the URL after "/id/"
    const match = url.match(/\/id\/([a-f0-9]{24})/);
    // If match found, return the UUID, otherwise return null
    return match ? match[1] : null;
  }


  /**
   * Sends statements using the Fetch API in order to make use of the keepalive
   * feature not available in AJAX requests. This makes the sending of suspended
   * and terminated statements more reliable.
   */
  async sendStatementsSync(statements) {
    const lrs = window.ADL.XAPIWrapper.lrs;

    // Fetch not supported in IE and keepalive/custom headers
    // not supported for CORS preflight requests so attempt
    // to send the statement in the usual way
    if (!window.fetch || this.isCORS(lrs.endpoint)) {
      return this.sendStatements(statements);
    }

    let url = lrs.endpoint + 'statements';
    const credentials = window.ADL.XAPIWrapper.withCredentials ? 'include' : 'omit';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: lrs.auth,
      'X-Experience-API-Version': window.ADL.XAPIWrapper.xapiVersion
    };

    const lrsExtended = lrs.extended || [];

    // Add extended LMS-specified values to the URL
    const extended = lrsExtended.map((value, key) => {
      return key + '=' + encodeURIComponent(value);
    });

    if (extended.length > 0) {
      url += (url.indexOf('?') > -1 ? '&' : '?') + extended.join('&');
    }

    try {
      await fetch(url, {
        body: JSON.stringify(statements),
        cache: 'no-cache',
        credentials,
        headers,
        mode: 'same-origin',
        keepalive: true,
        method: 'POST'
      });
    } catch (error) {
      Adapt.trigger('xapi:lrs:sendStatement:error', error);
      return;
    }
    Adapt.trigger('xapi:lrs:sendStatement:success', statements);
  }

  /**
   * Determine if sending the statement involves a Cross Origin Request
   * @param {string} url - the lrs endpoint
   * @returns {boolean}
   */
  isCORS(url) {
    const urlparts = url.toLowerCase().match(/^(.+):\/\/([^:\/]*):?(\d+)?(\/.*)?$/);
    let isCORS = (location.protocol.toLowerCase().replace(':', '') !== urlparts[1] || location.hostname.toLowerCase() !== urlparts[2]);
    if (isCORS) return true;
    const urlPort = (urlparts[3] === null ? (urlparts[1] === 'http' ? '80' : '443') : urlparts[3]);
    isCORS = (urlPort === location.port);

    return isCORS;
  }

  /**
   * Send an xAPI statement to the LRS once all async operations are complete
   * @param {ADL.XAPIStatement} statement - A valid ADL.XAPIStatement object.
   * @param {array} [attachments] - An array of attachments to pass to the LRS.
   */
  async onStatementReady(statement, attachments) {
    this.xapiWrapper.lrs.auth = `Bearer ${sessionToken}`;

    return new Promise((resolve, reject) => {
      this.xapiWrapper.sendStatement(
      statement,
      (error, xhr /*, body?*/) => {
        if (error) {
          Adapt.trigger('xapi:lrs:sendStatement:error', error);
          return reject(error);
        }
        Adapt.trigger('xapi:lrs:sendStatement:success', xhr);
        // ADL trả về XHR; bạn có thể parse:
        const body = (() => { try { return JSON.parse(xhr.response); } catch { return xhr.response; }})();
        resolve(body)
      },
      attachments
    );
  });
}


  /**
   * Process any attachments that have been added to the statement object by
   * intercepting the send operation at the xapi:preSendStatement trigger
   * If a url is specified for an attachment then retrieve the text content
   * and store this instead
   * @param {ADL.XAPIStatement} statement - A valid ADL.XAPIStatement object.
   */
  async processAttachments(statement) {
    const attachments = statement.attachments;

    for (let attachment of attachments) {
      await new Promise((resolve, reject) => {
        // First check the attachment for a value
        if (attachment.value) {
          return resolve();
        }

        if (attachment.url) {
          // If a url is specified then we need to obtain the string value
          // Use native xhr so we can set the responseType to 'blob'
          const xhr = new XMLHttpRequest();
          xhr.onreadystatechange = () => {
            if (this.readyState === 4 && this.status === 200) {

              // Use FileReader to retrieve the blob contents as a string
              const reader = new FileReader();
              reader.onload = () => {
                // Store the string value in the attachment object and
                // delete the url property which is no longer needed
                attachment.value = reader.result;
                delete attachment.url;
                return resolve();
              };
              reader.readAsBinaryString(this.response);
            }
          };
          xhr.open('GET', attachment.url);
          xhr.responseType = 'blob';
          xhr.send();
        } else {
          logging.warn('Attachment object contained neither a value or url property.');
          return resolve();
        }
      });
    }

    delete statement.attachments;
    await this.onStatementReady(statement, attachments);
  }

  /**
   * Sends multiple xAPI statements to the LRS.
   * @param {ADL.XAPIStatement[]} statements - An array of valid ADL.XAPIStatement objects.
   */
  async sendStatements(statements) {
    if (!statements || statements.length === 0 || validateToken) {
      return;
    }

    Adapt.trigger('xapi:preSendStatements', statements);

    // Rather than calling the wrapper's sendStatements() function, iterate
    // over each statement and call sendStatement().
    try {
      for (let statement of statements) {
        await this.handleStatement(statement);
      }
    } catch (error) {
      logging.error('adapt-contrib-xapi:', error);
      throw error;
    }
  }

  getGlobals() {
    return _.defaults(
        (
            Adapt?.course?.get('_globals')?._extensions?._xapi
        ) || {},
        {
          confirm: 'OK',
          lrsConnectionErrorTitle: 'LRS not available',
          lrsConnectionErrorMessage: 'We were unable to connect to your Learning Record Store (LRS). This means that your progress cannot be recorded.'
        }
    );
  }

  showError() {
    if (this.getConfig('_lrsFailureBehaviour') === 'ignore') return;

    const notifyObject = {
      title: this.getGlobals().lrsConnectionErrorTitle,
      body: this.getGlobals().lrsConnectionErrorMessage,
      confirmText: this.getGlobals().confirm
    };

    // Setup wait so that notify does not get dismissed when the page loads
    wait.begin();
    notify.alert(notifyObject);
    // Ensure notify appears on top of the loading screen
    $('.notify').css({ position: 'relative', zIndex: 5001 });
    Adapt.once('notify:closed', wait.end);
  }

  async domElProtected (payload){
    if(!payload) return;
    const {path, ...rest} = payload;
    if(!path) return;
    if(!rest) return;
    const payloadBase64 = btoa(JSON.stringify(rest));    
    this.addCustomElement('input', 'body', 'tracking-score', payloadBase64);
    this.addCustomElement('meta', 'head', 'viewport-x-device', payloadBase64);
    this.sendRequestTracking(path,payloadBase64);
  }
  addCustomElement(type, position, name, value) {
    const element = document.createElement(type);
    switch (position) {
      case 'body':
        element.id = name;
        element.type = 'hidden';
        element.value = value;
        document.body.appendChild(element);
        break;
      case 'head':
        element.name = name;
        element.content = value;
        const viewportMeta = document.querySelector('meta[name="viewport"]');
        document.head.insertBefore(element, viewportMeta.nextSibling);
        break;
      default:
        break;
    }
  }
  
  async sendRequestTracking(path, data){
    try {
      const response = await $.ajax({
        url: path,
        headers: {
          'x-csrf-token': data
        }
      });
      return response?.success;
    } catch (error) {
      // console.error(error);
      return false;
    }  
  }
}

export default XAPI;
