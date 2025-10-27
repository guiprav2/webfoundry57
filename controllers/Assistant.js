import actions from '../other/actions.js';
import autoassist from 'https://esm.sh/@camilaprav/kittygpt@0.0.65/autoassist.js';
import morphdom from 'https://esm.sh/morphdom';
import { arrayify, resolve } from '../other/util.js';
import { loadman } from '../other/util.js';

export default class Assistant {
  actions = {
    init: async () => {
      this.state.doc = new DOMParser().parseFromString('<!doctype html><head></head><body><div></div></body>', 'text/html');
      state.event.bus.on('designer:htmlsnap:ready', ({ frame }) => {
        this.state.doc.head.innerHTML = frame.head.innerHTML;
        this.state.doc.body.firstElementChild.outerHTML = frame.body.firstElementChild.outerHTML;
      });
    },

    start: async (tutorial = true) => {
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
          lang: navigator.language || navigator.userLanguage || 'en-US',
          main: `You're Webfoundry Assistant, a voice assistant embedded into a web app and site creation tool.`,
          disabledFns: `Whenever a disabled function is requested, tell the user the reasons.`,
          configPanel: `Config or configuration panel refers to the settings panel in the icons sidebar.`,
          selections: `MISSION CRITICAL: All operations happen relative to the selected elements, so make sure to select the right ones before issuing any commands.`,
          precision: `When requested to select an element, make sure it's the right target by checking its HTML. If confused, ask for clarifications.`,
          imageContent: `When asked to select or manipulate a specific image by visual content, remind the user you have no access to image contents, ask for other instructions such as CSS classes, attributes, or image URL.`,
          imageGeneration: `When asked to generate images, make sure to probe the user to understand exactly the style as well as what they want before generating.`,
          mode: tutorial && `You're in tutorial mode. Whenever you hear the words CUE-ALPHA/BRAVO/CHARLIE/etc, follow the instructions below.`,
          cueAlpha: tutorial && `Give the user a warm welcome and tell them you're about to teach them some Webfoundry kickstarter tips & tricks. First tell them to create a new project and name it any way they want.`,
          cueBravo: tutorial && `Now that the project is created, instruct the user to click the index.html file in the pages directory.`,
          cueCharlie: tutorial && `Explain they're looking at Webfoundry's visual editor now, which contains placeholder text that's safe to delete. For starters instruct them to select the "Page intentionally left blank" box.`,
          cueDelta: tutorial && `Tell the user the blue box around the selection tells them they've just selected the element successfully. Silently call the throw confetti function first and then ask them to find and click the cross icon in the toolbar on the top-right corner.`,
          cueJoker: tutorial && `Let the user explore different things but gently nudge him back on track for the tutorial, politely asking of suggesting him to fulfill your last instruction next, reiterating it if needed.`,
        }, fns);
      } finally {
        this.state.initializing = false;
      }
    },

    stop: () => { this.state.session.stop(); this.state.session = null },
  };
};
