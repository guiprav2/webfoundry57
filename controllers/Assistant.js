import actions from '../other/actions.js';
import autoassist from 'https://esm.sh/@camilaprav/kittygpt@0.0.59/autoassist.js';
import morphdom from 'https://esm.sh/morphdom';
import { arrayify, resolve } from '../other/util.js';

export default class Assistant {
  actions = {
    init: async () => {
      this.state.doc = new DOMParser().parseFromString('<!doctype html><head></head><body><div></div></body>', 'text/html');
      state.event.bus.on('designer:save:ready', () => {
        morphdom(this.state.doc.head, state.designer.current.head.cloneNode(true));
        morphdom(this.state.doc.body.firstElementChild, state.designer.current.body.firstElementChild.cloneNode(true));
      });
    },

    start: async () => {
      try {
        this.state.initializing = true;
        d.update();
        this.state.session = await autoassist({
          endpoint: 'https://kittygpt.netlify.app/.netlify/functions/voicechat',
          navdisable: true,
          idtrack: true,
          removeInvisible: false,
          scope: this.state.doc.documentElement,
          pushToSpeak: state.settings.opt.shiftToSpeak && 'Shift',
        });
        let fns = Object.fromEntries([...Object.entries(actions)].map(([k, v]) => [k, {
          description: v.description,
          parameters: v.parameters,
          handler: async params => {
            try {
              if (document.querySelector('dialog')) throw new Error(`Operation not possible: A modal dialog is currently open`);
              let disabled = v?.disabled?.(params)?.filter?.(Boolean);
              if (disabled?.length) return { success: false, error: `Operation not possible because:\n${disabled.map(x => `- ${x}`).join('\n')}` };
              return await v.handler(params);
            } catch (err) {
              console.error(err);
              return { success: false, error: err.toString() };
            }
          },
        }]));
        this.state.session.sysupdate({
          main: `You're Webfoundry Assistant, a voice assistant embedded into a web app and site creation tool.`,
          disabledFns: `Whenever a disabled function is requested, tell the user the reasons.`,
          configPanel: `Config or configuration panel refers to the settings panel in the icons sidebar.`,
          selections: `MISSION CRITICAL: All operations happen relative to the selected elements, so make sure to select the right ones before issuing any commands.`,
          precision: `When requested to select an element, make sure it's the right target by checking its HTML. If confused, ask for clarifications.`,
          imageContent: `When asked to select or manipulate a specific image by visual content, remind the user you have no access to image contents, ask for other instructions such as CSS classes, attributes, or image URL.`,
          imageGeneration: `When asked to generate images, make sure to probe the user to understand exactly the style as well as what they want before generating.`,
        }, fns);
      } finally {
        this.state.initializing = false;
      }
    },

    stop: () => { this.state.session.stop(); this.state.session = null },
  };
};
