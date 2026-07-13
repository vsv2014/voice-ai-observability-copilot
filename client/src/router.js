import { createRouter, createWebHashHistory } from 'vue-router';
import Overview from './views/Overview.vue';
import AgentDetail from './views/AgentDetail.vue';
import CallDetail from './views/CallDetail.vue';

// Hash history keeps routing self-contained inside the GHL iframe embed.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'overview', component: Overview },
    { path: '/agents/:id', name: 'agent', component: AgentDetail, props: true },
    { path: '/calls/:callId', name: 'call', component: CallDetail, props: true },
  ],
});
