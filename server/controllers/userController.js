/* eslint-disable camelcase */
const UserRouter = require('express').Router();
const validator = require('validator').default;
const { v4: uuidv4 } = require('uuid');

const User = require('../models/UserSchema');

let accessToken = process.env.ACCESS_TOKEN;
const clientId = process.env.clientId;
const clientSecret = process.env.clientSecret;
const domain = process.env.DOMAIN;

const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: `Bearer ${accessToken}`,
};

const {
  OK,
  NOT_FOUND,
  NOT_ACCEPTABLE,
  INTERNAL_SERVER_ERROR,
  CONFLICT,
} = require('../httpStatusCodes.js');

// Defining separate email validation middleware
const emailValidator = (req, res, next) => {
  const { email } = req.body;

  if (typeof email !== 'string' || !validator.isEmail(email)) {
    return res.status(NOT_ACCEPTABLE).json({
      message: 'Email is invalid',
    });
  } else {
    next();
  }
};

const getAccessToken = async () => {
  try {
    const response = await fetch(`${domain}/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: `${domain}/api`,
      }),
    });

    if (!response.ok) {
      throw new Error(`couldn't get access token`);
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('An error occurred:', error);
  }
};

const getKindeUser = async (email) => {
  const response = await fetch(`${domain}/api/v1/users?email=${email}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  let data;
  if (!response.ok) {
    const errorText = await response.json(); // Capture the error response text
    if (errorText.errors[1].code === 'TOKEN_INVALID') {
      const newAccessToken = await getAccessToken();
      accessToken = newAccessToken;

      const response = await fetch(`${domain}/api/v1/users?email=${email}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${newAccessToken}`,
        },
      });

      data = await response.json();
    } else {
      console.log(errorText);
      throw new Error(`Couldn't get user from kinde`);
    }
  } else {
    data = await response.json();
  }
  return data;
};

const createUserWithId = async (email, id) => {
  // Logic to create a new user with a provided ID
  const getUser = await getKindeUser(email);
  const doesUserExist = getUser.users ? true : false;

  if (doesUserExist) {
    return User.create({ _id: id, email });
  }

  const inputBody = {
    identities: [
      {
        type: 'email',
        details: {
          email: email,
        },
      },
    ],
  };
  const response = await fetch(`${domain}/api/v1/user`, {
    method: 'POST',
    body: JSON.stringify(inputBody),
    headers: headers,
  });

  if (!response.ok) {
    const errorText = await response.json(); // Capture the error response text
    if (errorText.errors[1].code === 'TOKEN_INVALID') {
      const newAccessToken = await getAccessToken();
      accessToken = newAccessToken;

      await fetch(`${domain}/api/v1/user`, {
        method: 'POST',
        body: JSON.stringify(inputBody),
        headers: headers,
      });
    } else {
      throw new Error(`Couldn't add user to kinde`);
    }
  }

  return User.create({ _id: id, email });
};

const createUserWithAutoId = async (email) => {
  // Logic to create a new user with an autogenerated ID
  return User.create({ _id: uuidv4(), email });
};

const loginUser = async (req, res) => {
  const { email, id } = req.body;
  try {
    const findUser = await User.findOne({ email });

    if (!findUser) {
      let newUser;

      if (id) {
        // Create a new user with a provided ID
        newUser = await createUserWithId(email, id);
      } else {
        // Create a new user with an autogenerated ID
        newUser = await createUserWithAutoId(email);
      }

      const newId = newUser._id;

      return res.status(200).json({
        id: newId,
      });
    } else if (findUser && id) {
      // User already exists, and an ID was provided
      return res.status(CONFLICT).json();
    }

    // User exists, return their ID
    res.status(OK).json({
      id: findUser._id,
    });
  } catch (err) {
    // Handle errors
    res.status(INTERNAL_SERVER_ERROR).json({
      message: `An error occurred while logging in: ${err}`,
    });
  }
};

const getProfile = async (req, res) => {
  try {
    const { email } = req.params;

    // Find the user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(NOT_FOUND).json({ error: 'User not found' });
    }

    // Send the user profile data as JSON response
    res.status(OK).json(user);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
  }
};

const updateProfile = async (req, res) => {
  const { username, aboutMe, gender, age, email, settings } = req.body;

  try {
    // Find the user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(NOT_FOUND).json({ error: 'User not found' });
    }

    // Update user's profile with provided fields or the User fields or defaults
    user.username = username || user.username || 'Anonymous';
    user.aboutMe = aboutMe || user.aboutMe || null;
    user.gender = gender || user.gender || 'Unknown';
    user.age = age || user.age || null;
    user.settings = settings || user.settings;

    // Save the updated user profile
    await user.save();

    return res.status(OK).json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error(error);
    return res
      .status(INTERNAL_SERVER_ERROR)
      .json({ error: 'Internal server error' });
  }
};

const deleteUser = async (req, res) => {
  const { email } = req.body;

  try {
    // Find the user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(NOT_FOUND).json({ error: 'User not found' });
    }

    const kindeUser = await getKindeUser(email);
    const kindeUserId = kindeUser.users[0].id;

    // delte user from kinde
    const response = await fetch(`${domain}/api/v1/user?id=${kindeUserId}`, {
      method: 'DELETE',

      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(response.text());
    }
    // Delete the user
    await user.deleteOne();

    return res.status(OK).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    return res
      .status(INTERNAL_SERVER_ERROR)
      .json({ error: 'Internal server error' });
  }
};

UserRouter.route('/login').post(emailValidator, loginUser);
UserRouter.route('/profile').post(emailValidator, updateProfile);
UserRouter.route('/profile/:email').get(getProfile);
UserRouter.route('/deleteUser').delete(emailValidator, deleteUser); //Email validation applied to the required request handlers

module.exports = UserRouter;
