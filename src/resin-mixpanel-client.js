var Promise = require('bluebird')
var mixpanelLib = require('resin-universal-mixpanel')

module.exports = function(token, options) {

	var mixpanel = mixpanelLib.init(token, options)
	var isBrowser = typeof window !== 'undefined'

	mixpanel.set_config({
		track_pageview: false
	})

	// the browser mixpanel library calls the callback with the response object (in verbose mode)
	// or the status 0/1/-1 in non-verbose mode
	// we normalize it here to match the node style and work with Promise.fromCallback
	function wrapBrowserCallback(callback) {
		if (!callback) return null
		return function(response) {
			if (typeof response === 'number' && response !== 1) {
				return callback(new Error('Mixpanel error: ' + response))
			}
			if (response && response.error) {
				return callback(response.error)
			}
			callback(null, response)
		}
	}

	// Like Promise.fromCallback, but handling mixpanel's crazy
	// callback format if required (if we're in a browser)
	function mixpanelToPromise(callbackBasedFunction) {
		return Promise.fromCallback(function (callback) {
			if (isBrowser) {
				callbackBasedFunction(wrapBrowserCallback(callback))
			} else {
				callbackBasedFunction(callback)
			}
		})
	}

	function associateDeviceId(deviceIds, userName, callIdentify) {
		var distinctId = mixpanel.get_property('distinct_id');
		var originalDeviceId = mixpanel.get_property('$device_id');

		if (callIdentify) {
			originalDeviceId = deviceIds[0];
			mixpanel.identify(originalDeviceId);
			distinctId = mixpanel.get_property('distinct_id');
		}

		// Send alias events to combine all input devices under a single user name.
		for (var i = 0; i < deviceIds.length; i++) {
			var deviceId = deviceIds[i];
			if (!callIdentify || i > 0) {
				mixpanel.register({
					'distinct_id': deviceId,
					'$device_id': deviceId
				});
			}
			// All but the first alias calls are for our proxy only. They are practically rejected by MixPanel.
			mixpanel.alias(userName, deviceId);
		}

		// Restore original state.
		mixpanel.register({
			'distinct_id': distinctId,
			'$device_id': originalDeviceId
		});
	}

	var self = {
		signup: function(uid, deviceIds) {
			return mixpanelToPromise(function (callback) {
				if (isBrowser) {
					if (deviceIds && deviceIds.length > 0) {
						associateDeviceId(deviceIds, uid, true);
						callback();
					} else {
						callback(mixpanel.alias(uid))
					}
				} else {
					mixpanel.alias(uid, uid, callback)
				}
			}).then(function() {
				// calling `login` from here is the only way to ensure
				// `identify` is called before continuing to tracking
				return self.login(uid)
			})
		},
		login: function(uid, deviceIds) {
			self.userId = uid

			return mixpanelToPromise(function (callback) {
				if (isBrowser) {
					if (deviceIds && deviceIds.length > 0) {
						associateDeviceId(deviceIds, uid, false);
					}
					mixpanel.identify(uid)
					callback()
				} else {
					mixpanel.people.set_once(uid, { '$distinct_id': uid }, callback)
				}
			})
		},
		logout: function() {
			self.userId = null

			return mixpanelToPromise(function (callback) {
				if (isBrowser) {
					callback(mixpanel.reset())
				} else {
					// Node module has no state, so no-op.
					callback(null, true)
				}
			})
		},
		setUser: function(props) {
			return mixpanelToPromise(function(callback) {
				if (!self.userId) {
					throw new Error('(Resin Mixpanel Client) Please login() before using setUser()')
				}

				if (isBrowser) {
					mixpanel.people.set(props, callback)
				} else {
					mixpanel.people.set(self.userId, props, callback)
				}
			})
		},
		setUserOnce: function(props) {
			return mixpanelToPromise(function(callback) {
				if (!self.userId) {
					throw new Error('(Resin Mixpanel Client) Please login() before using setUserOnce()')
				}

				if (isBrowser) {
					mixpanel.people.set_once(props, callback)
				} else {
					mixpanel.people.set_once(self.userId, props, callback)
				}
			})
		},
		track: function(event, props) {
			return mixpanelToPromise(function(callback) {
				if (!isBrowser && self.userId) {
					props.distinct_id = self.userId
				}

				return mixpanel.track(event, props, callback)
			})
		},
		getDistinctId: function() {
			if (isBrowser) {
				return mixpanel.get_distinct_id()
			} else {
				throw new Error('(Resin Mixpanel Client) function getDistinctId is only available for the browser')
			}
		},
		identify: function(id) {
			if (isBrowser) {
				return mixpanel.identify(id)
			} else {
				throw new Error('(Resin Mixpanel Client) function identify is only available for the browser')
			}
		}
	}

	return self
}
