import React, { createContext, useContext, useState } from 'react';

const VariantContext = createContext({ variant: 'A', setVariant: () => {} });

export function VariantProvider({ children }) {
  const [variant, setVariantState] = useState(
    () => localStorage.getItem('file_variant') || 'A'
  );

  const setVariant = (v) => {
    localStorage.setItem('file_variant', v);
    setVariantState(v);
  };

  return (
    <VariantContext.Provider value={{ variant, setVariant }}>
      {children}
    </VariantContext.Provider>
  );
}

export function useVariant() {
  return useContext(VariantContext);
}
