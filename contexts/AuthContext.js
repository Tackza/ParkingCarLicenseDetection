import React, { createContext, useState, useContext } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const login = async (username, password) => {
    setIsLoading(true);
    try {
      // TODO: เชื่อมต่อกับ API จริง
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (username && password) {
        const userData = {
          id: '1',
          username: username,
          token: 'mock-token-' + Date.now(),
        };
        setUser(userData);
        return { success: true, user: userData };
      }

      return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    } catch (error) {
      return { success: false, message: error.message };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};