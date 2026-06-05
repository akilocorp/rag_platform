import React, { useRef, useState } from 'react';
import { FaMicrophone, FaSpinner, FaStop } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const VoiceRecordButton = ({ onTranscribed, disabled }) => {
  const [state, setState] = useState('idle');
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size === 0) {
          setState('idle');
          return;
        }
        setState('transcribing');
        try {
          const fd = new FormData();
          const ext = (recorder.mimeType || 'audio/webm').includes('mp4') ? 'mp4' : 'webm';
          fd.append('audio', blob, `recording.${ext}`);
          const res = await apiClient.post('/audio/transcribe', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          const text = (res.data?.text || '').trim();
          if (text) onTranscribed?.(text);
        } catch (e) {
          console.error('Transcription failed', e);
        } finally {
          setState('idle');
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setState('recording');
    } catch (e) {
      console.error('Microphone access failed', e);
      stopStream();
      setState('idle');
    }
  };

  const stop = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  const handleClick = () => {
    if (state === 'idle') start();
    else if (state === 'recording') stop();
  };

  const isTranscribing = state === 'transcribing';
  const isRecording = state === 'recording';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isTranscribing}
      title={isRecording ? 'Stop and send' : isTranscribing ? 'Transcribing…' : 'Record voice message'}
      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 shrink-0 ${
        isRecording
          ? 'bg-red-500 hover:bg-red-600 text-white'
          : 'text-gray-500 hover:text-[#FA6C43] hover:bg-gray-100'
      }`}
    >
      {isTranscribing ? (
        <FaSpinner className="animate-spin text-base" />
      ) : isRecording ? (
        <FaStop className="text-base" />
      ) : (
        <FaMicrophone className="text-base" />
      )}
    </button>
  );
};

export default VoiceRecordButton;
