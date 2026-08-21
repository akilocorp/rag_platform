// @language  JavaScript
// @updated   2026-08-10
// @changed   New file: one record per bot_type, replacing the student-URL maps that were
//            duplicated in ConfigList and JoinPage.

// Everything the student side needs to know about a class type in one place: what to
// call it, what the student is there to do, where "enter" goes, and which part of the
// user guide explains it.
//
// `guideAnchor` matches the slug GuideMarkdown derives from the headings in
// guide/pages/student-exercises.md — change a heading there and change it here.
import { FaComments, FaUsers, FaFilm, FaFlask, FaUserTie } from 'react-icons/fa';

export const BOT_TYPES = {
  chat: {
    label: '1-on-1 Chat',
    blurb: 'Chat one-on-one with an assistant your professor set up.',
    icon: FaComments,
    path: (id) => `/chat/${id}`,
    guideAnchor: 'student-exercises#chatting-with-an-assistant',
  },
  group_chat: {
    label: 'Group Chat',
    blurb: 'Get matched with classmates and discuss alongside AI participants.',
    icon: FaUsers,
    path: (id) => `/group-chat/${id}`,
    guideAnchor: 'student-exercises#group-chats',
  },
  video_analysis: {
    label: 'Video Analysis',
    blurb: 'Record and submit a video, then read the feedback on your delivery.',
    icon: FaFilm,
    path: (id) => `/video-upload/${id}`,
    guideAnchor: 'student-exercises#submitting-a-video',
  },
  experiential: {
    label: 'Experiential Lab',
    blurb: 'Work through a scenario, commit to predictions, and see what follows.',
    icon: FaFlask,
    path: (id) => `/experiential/c/${id}`,
    guideAnchor: 'student-exercises#experiential-labs',
  },
  manager_exercise: {
    label: 'Manager Exercise',
    blurb: 'Pick a candidate on your own, then decide as a group with a facilitator.',
    icon: FaUserTie,
    path: (id) => `/manager-exercise/${id}`,
    guideAnchor: 'student-exercises#manager-exercise',
  },
};

// Unknown or missing bot_type falls back to plain chat — the same default the route
// maps this replaced always had.
export const botTypeInfo = (botType) => BOT_TYPES[botType] || BOT_TYPES.chat;

// The student-facing path for a config. Callers that need an absolute URL (share
// links) prefix window.location.origin themselves.
export const studentPathFor = (botType, configId) => botTypeInfo(botType).path(configId);
