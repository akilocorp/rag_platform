from flask_mail import Mail
from flask_bcrypt import Bcrypt
from flask_jwt_extended import JWTManager

# Initialize extensions here (unbound to any app)
mail = Mail()
bcrypt = Bcrypt()
jwt = JWTManager()