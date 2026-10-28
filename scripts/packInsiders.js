'use strict';

const { packExtension, reportError } = require('./packExtension');

packExtension({ insiders: true }).catch(reportError);
