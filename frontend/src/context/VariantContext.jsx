import React, { createContext, useContext, useEffect, useState } from 'react';
import apiClient from '../api/apiClient';

const VariantContext = createContext({ variant: 'A' });

export function VariantProvider({ children }) {
  const [variant, setVariant] = useState('A');

  useEffect(() => {
    const token = localStorage.getItem('jwtToken') || localStorage.getItem('access_token');
    if (!token) return;
    apiClient.get('/auth/me/variant')
      .then((res) => setVariant(res.data.variant || 'A'))
      .catch(() => {});
  }, []);

  return (
    <VariantContext.Provider value={{ variant }}>
      {children}
    </VariantContext.Provider>
  );
}

export function useVariant() {
  return useContext(VariantContext);
}
